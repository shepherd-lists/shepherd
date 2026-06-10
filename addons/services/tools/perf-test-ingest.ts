/**
 * Performance / load test for the ingest download path.
 *
 * STEP 2: replay the captured GQL page fixtures (see capture-gql-pages.ts)
 * through the REAL ingest path — ingressHandler -> downloadWithChecks ->
 * chunkTxDataStream (the 'nodes' source) -> chunk node sockets + S3 upload —
 * and sample what the network connections look like under load.
 *
 * Goal: the singleton http.Agent({ maxSockets: 100 }) in chunkFetch.ts is now
 * the real external-I/O throttle (it used to be per-lambda). We want to see
 * whether one node process saturates / queues behind that cap, and what the
 * socket/handle/event-loop/memory profile is under sustained load.
 *
 * Drives the 'nodes' source ONLY (gatewayStream is legacy/backup).
 *
 * Requires: MinIO (S3) + Postgres reachable per _import-test-env-vars
 * (the SSH tunnels in NOTES.txt), and the fixtures already captured.
 *
 * Config is fixed in-file (consts below) — edit to change the run.
 *
 * Usage:
 *   npx tsx perf-test-ingest.ts
 */
import '../tests/_import-test-env-vars'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import pLimit from 'p-limit'
import type { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { ingressHandler } from '../services/indexer-next/src/index-shared/ingress/index'
import { chunkStreamAgent } from '../libs/chunkStreams/chunkFetch'
import pool from '../libs/utils/pgClient'
import { s3DeleteObject } from '../libs/utils/s3-services'

const execFileP = promisify(execFile)

/** --- knobs (edit + re-run to sweep) --- */
const FIXTURE_DIR = resolve('./fixtures/gql-pages')
const MAX_PAGES = 30           // how many captured pages to replay this run
const BATCH_CONCURRENCY = 20   // matches MAX_INGRESS_CONCURRENCY in query-processor
const BATCH_SIZE = 50          // matches CHUNKS_BATCH_SIZE for the 'nodes' source
const DOWNLOAD_TIMEOUT = 90_000
const SAMPLE_INTERVAL_MS = 1_000

/** goldsky is the real primary gql now (the legacy `gql_url`/GQL_URL = arweave.net
 * is commented out in config.dev, so it resolves undefined — which made getParent
 * fail the primary lookup every time and limp on the backup). goldsky lives in the
 * legacy-named GQL_URL_SECONDARY. so: primary = goldsky, fallback = arweave.net. */
const GQL_PRIMARY = process.env.GQL_URL_SECONDARY || 'https://arweave-search.goldsky.com/graphql'
const GQL_FALLBACK = process.env.GQL_URL || 'https://arweave.net/graphql'
if (!GQL_PRIMARY) throw new Error('no gql endpoint resolved (check config.dev gql_url_secondary)')

/** load up to MAX_PAGES of fixtures into one flat list of edges */
const loadEdges = async (): Promise<GQLEdgeInterface[]> => {
	const files = (await readdir(FIXTURE_DIR))
		.filter(f => /^page-\d+\.json$/.test(f))
		.sort()
		.slice(0, MAX_PAGES)
	if (files.length === 0) throw new Error(`no fixtures in ${FIXTURE_DIR} — run capture-gql-pages.ts first`)

	const edges: GQLEdgeInterface[] = []
	for (const f of files) {
		edges.push(...JSON.parse(await readFile(join(FIXTURE_DIR, f), 'utf-8')) as GQLEdgeInterface[])
	}
	console.info(`loaded ${edges.length} edges from ${files.length} fixture pages`)
	return edges
}

/** make the run repeatable: clear the fixture txids from `txs` and from MinIO so
 * the DB-dedup in metaFilteredRecords doesn't skip everything on a re-run (which
 * is exactly what made the second run finish instantly). real txs table + bucket,
 * only the fixture txids are touched. */
const resetState = async (edges: GQLEdgeInterface[]) => {
	const txids = edges.map(e => e.node.id)
	const bucket = process.env.AWS_INPUT_BUCKET!

	// DB: single batched delete
	const del = await pool.query(`DELETE FROM txs WHERE txid = ANY($1::text[])`, [txids])
	console.info(`reset: deleted ${del.rowCount} rows from txs`)

	// MinIO: bounded-parallel deletes (don't swamp it during setup); 404s are fine
	const delLimit = pLimit(50)
	let removed = 0
	await Promise.all(txids.map(txid => delLimit(async () => {
		try { await s3DeleteObject(bucket, txid); removed++ } catch { /* not present, fine */ }
	})))
	console.info(`reset: deleted ${removed}/${txids.length} objects from ${bucket}`)
}

/** sum the per-host socket maps on an http.Agent */
const agentSnapshot = (agent: typeof chunkStreamAgent) => {
	const count = (m: Record<string, unknown[]> | undefined) =>
		Object.values(m ?? {}).reduce((n, arr) => n + arr.length, 0)
	// per-host in-flight sockets (actual requests per node), shortened key e.g. tip-1
	const perHost = (m: Record<string, unknown[]> | undefined) =>
		Object.entries(m ?? {})
			.map(([host, arr]) => `${host.replace(/\.arweave\.xyz.*$/, '').replace(/:.*$/, '')}=${arr.length}`)
			.join(',')
	return {
		inUse: count(agent.sockets as never),       // sockets actively assigned to a request
		queued: count(agent.requests as never),     // requests waiting because maxSockets is hit
		free: count(agent.freeSockets as never),    // idle keep-alive sockets
		hosts: Object.keys(agent.sockets ?? {}).length,
		perHostInUse: perHost(agent.sockets as never), // in-flight requests broken down per node
		perHostQueued: perHost(agent.requests as never), // queued requests per node
	}
}

/** count ESTABLISHED tcp connections owned by this process (darwin lsof) */
const osConnections = async (): Promise<number> => {
	try {
		const { stdout } = await execFileP('lsof', ['-nP', '-iTCP', '-sTCP:ESTABLISHED', '-a', '-p', String(process.pid)])
		return stdout.trim().split('\n').length - 1 // minus header
	} catch {
		return -1
	}
}

const main = async () => {
	const edges = await loadEdges()

	// repeatability: clear prior state so every run does the full download work
	await resetState(edges)

	// chop into batches like batchAndDispatchEdges does for 'nodes'
	const batches: GQLEdgeInterface[][] = []
	for (let i = 0; i < edges.length; i += BATCH_SIZE) batches.push(edges.slice(i, i + BATCH_SIZE))
	console.info(`replaying ${batches.length} batches @ concurrency ${BATCH_CONCURRENCY}, agent maxSockets=${chunkStreamAgent.maxSockets}`)

	// app-level throughput counters, mutated as batches resolve
	const totals = { batchesDone: 0, queued: 0, updated: 0, errored: 0 }
	const loopDelay = monitorEventLoopDelay({ resolution: 20 })
	loopDelay.enable()

	const t0 = performance.now()

	// 1s sampler — the actual measurement
	const samples: string[] = []
	const sampler = setInterval(async () => {
		const a = agentSnapshot(chunkStreamAgent)
		const os = await osConnections()
		const mem = process.memoryUsage()
		const elapsed = ((performance.now() - t0) / 1000).toFixed(0)
		const elMaxMs = (loopDelay.max / 1e6).toFixed(0)
		loopDelay.reset()
		const line = [
			`t=${elapsed}s`,
			`agent[inUse=${a.inUse} queued=${a.queued} free=${a.free} hosts=${a.hosts}]`,
			`perNode[${a.perHostInUse}]`,
			...(a.perHostQueued ? [`perNodeQ[${a.perHostQueued}]`] : []),
			`osTCP=${os}`,
			`handles=${(process as any)._getActiveHandles().length}`,
			`reqs=${(process as any)._getActiveRequests().length}`,
			`rss=${(mem.rss / 1024 / 1024).toFixed(0)}MB`,
			`elLagMax=${elMaxMs}ms`,
			`done=${totals.batchesDone}/${batches.length}`,
			`q=${totals.queued} upd=${totals.updated} err=${totals.errored}`,
		].join(' ')
		console.info(line)
		samples.push(line)
	}, SAMPLE_INTERVAL_MS)

	const limit = pLimit(BATCH_CONCURRENCY)
	// per-batch errors are CAPTURED, not fatal: one bad batch must not abandon the
	// whole run (that's what gave batchesDone=0). record the first error so it lands
	// in the log file instead of being buried in stderr/slackLog noise.
	const batchErrors: string[] = []
	try {
		await Promise.all(batches.map((batch, i) => limit(async () => {
			try {
				const res = await ingressHandler({
					metas: batch,
					pageNumber: `perf-${i}`,
					gqlUrl: GQL_PRIMARY,
					gqlUrlBackup: GQL_FALLBACK,
					gqlProvider: GQL_PRIMARY.includes('goldsky') ? 'goldsky.com' : 'arweave.net',
					indexName: 'perf-test',
					streamSourceName: 'nodes',
					downloadTimeout: DOWNLOAD_TIMEOUT,
				})
				totals.batchesDone++
				totals.queued += res.numQueued
				totals.updated += res.numUpdated
				totals.errored += res.errored.length
			} catch (err) {
				const e = err as Error
				if (batchErrors.length < 5) batchErrors.push(`batch ${i}: ${e.name}: ${e.message}`)
			}
		})))
	} finally {
		// always stop the sampler and persist the time-series, even on early error,
		// so the network profile can't be lost to terminal scroll-back / slackLog noise.
		clearInterval(sampler)
		loopDelay.disable()

		const secs = (performance.now() - t0) / 1000
		const summary = [
			'--- done ---',
			`${edges.length} edges in ${secs.toFixed(1)}s = ${(edges.length / secs).toFixed(1)} edges/s`,
			`queued=${totals.queued} updated=${totals.updated} errored=${totals.errored} (batchesDone=${totals.batchesDone}/${batches.length})`,
			...(batchErrors.length ? ['--- batch errors (first few) ---', ...batchErrors] : []),
		]
		summary.forEach(l => console.info(l))

		const outFile = resolve(`./perf-run-${new Date().toISOString().replace(/[:.]/g, '-')}.log`)
		const header = `# perf-test-ingest  maxPages=${MAX_PAGES} batchConcurrency=${BATCH_CONCURRENCY} batchSize=${BATCH_SIZE} agentMaxSockets=${chunkStreamAgent.maxSockets}`
		await writeFile(outFile, [header, ...samples, '', ...summary].join('\n') + '\n')
		console.info(`\nsamples (${samples.length}) + summary written to ${outFile}`)
	}
}

main()
	.then(() => process.exit(0))
	.catch(e => { console.error(e); process.exit(1) })
