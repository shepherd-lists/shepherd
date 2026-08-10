/**
 * Re-queue a wallet's transactions through the classification pipeline
 * (download → MinIO shepherd-input → minio2mq → classifiers).
 *
 * Does not call ingressHandler / filterMetas. Already-flagged txs may be
 * re-queued; http-api merge rules keep flagged=true sticky.
 * MIME is decided by libmagic in processRecord, not GQL Content-Type tags.
 *
 * Usage:
 *   npx tsx tools/classify-owner.ts <ownerAddress>
 *
 * Env + stack config from ../tests/_import-test-env-vars (dev stack).
 */
import '../tests/_import-test-env-vars'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { arGql } from 'ar-gql'
import type { GQLEdgeInterface } from 'ar-gql/dist/faces'
import pLimit from 'p-limit'
import { ownerTotalCount } from '../libs/block-owner/owner-totalCount'
import { min_data_size } from '../libs/constants'
import { destroyChunkStreamAgent } from '../libs/chunkStreams/chunkFetch'
import { destroyGatewayAgent } from '../libs/chunkStreams/gatewayStream'
import { chunkTxDataStream } from '../libs/chunkStreams/chunkTxDataStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import pool from '../libs/utils/pgClient'
import type { OwnersListRecord } from '../types'
import type { TxRecord } from 'shepherd-plugin-interfaces/types'
import { buildRecords } from '../services/indexer-next/src/index-shared/ingress/index'
import { downloadWithChecks, destroyMimeWorkers } from '../services/indexer-next/src/index-shared/ingress/downloadWithChecks'

/** Match indexer-next query-processor: CHUNKS_BATCH_SIZE / MAX_INGRESS_CONCURRENCY */
const DOWNLOAD_TIMEOUT = 90_000
const DOWNLOAD_BATCH = 50
const DOWNLOAD_CONCURRENCY = 20
const ABORT_METHODS = new Set(['manual', 'updating', 'blocked'])
const PLACEHOLDER_MIME = 'application/octet-stream'

const downloadLimit = pLimit(DOWNLOAD_CONCURRENCY)

const ownerQuery = `
query($cursor: String, $owners: [String!]) {
  transactions(
    owners: $owners
    after: $cursor
    first: 100
		sort: HEIGHT_DESC
  ) {
    pageInfo { hasNextPage }
    edges {
      cursor
      node {
        id
        data { size type }
        tags { name value }
        block { height }
        parent { id }
        owner { address }
      }
    }
  }
}
`

const [, , ...args] = process.argv
const ownerArg = args[0]?.trim()

if (!ownerArg) {
	console.error('Usage: npx tsx tools/classify-owner.ts <ownerAddress>')
	process.exit(1)
}

const owner = ownerArg.padEnd(43, ' ')
const gqlPrimary = process.env.GQL_URL_SECONDARY || 'https://arweave-search.goldsky.com/graphql'
const gqlFallback = process.env.GQL_URL || 'https://arweave.net/graphql'
const gql = arGql({ endpointUrl: gqlPrimary, retries: 3 })
const gqlBackup = arGql({ endpointUrl: gqlFallback, retries: 3 })

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const isOversizedAddMethod = (addMethod: string) => /^\d[\d,]*$/.test(addMethod.trim())

const interpretOwnersList = (row: OwnersListRecord | undefined): { abort: boolean; summary: string } => {
	if (!row) {
		return { abort: false, summary: 'not in owners_list' }
	}
	const { add_method, infractions } = row
	if (ABORT_METHODS.has(add_method)) {
		return {
			abort: true,
			summary: `owners_list add_method=${add_method} infractions=${infractions} — already on owner-blocking path; aborting`,
		}
	}
	if (add_method === 'auto') {
		return {
			abort: false,
			summary: `owners_list add_method=auto infractions=${infractions} — infractions only; classification still useful`,
		}
	}
	if (add_method === 'future') {
		return {
			abort: false,
			summary: `owners_list add_method=future infractions=${infractions} — future-only block; history not backfilled`,
		}
	}
	if (isOversizedAddMethod(add_method)) {
		return {
			abort: false,
			summary: `owners_list add_method=${add_method} infractions=${infractions} — too large for auto owner-block; not range-blocked`,
		}
	}
	return {
		abort: false,
		summary: `owners_list add_method=${add_method} infractions=${infractions} — unknown add_method; proceeding with caution`,
	}
}

const confirmProceed = async (): Promise<boolean> => {
	const rl = readline.createInterface({ input, output })
	try {
		const answer = (await rl.question('Proceed with classification re-queue? [y/N] ')).trim().toLowerCase()
		return answer === 'y' || answer === 'yes'
	} finally {
		rl.close()
	}
}

const formatReasonMap = (map: Record<string, number>) => {
	const parts = Object.entries(map)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${k}:${v}`)
	return parts.length ? parts.join(',') : '-'
}

const bumpReason = (map: Record<string, number>, reason: string | undefined) => {
	const key = reason || 'unknown'
	map[key] = (map[key] ?? 0) + 1
}

type PreparedPage = {
	pageNumber: number
	gqlCount: number
	negligibleData: number
	placeholderMime: number
	candidates: number
	records: TxRecord[]
	nextCursor: string
	hasNextPage: boolean
}

/** GQL fetch + filter + buildRecords for one page. Retries the same cursor on GQL errors. */
const preparePage = async (cursor: string, pageNumber: number): Promise<PreparedPage> => {
	while (true) {
		let page: GQLEdgeInterface[] = []
		let pageInfo = { hasNextPage: false }
		try {
			const res = (await gql.run(ownerQuery, {
				owners: [ownerArg],
				cursor,
			})).data.transactions
			page = res.edges
			pageInfo = res.pageInfo
		} catch (err: unknown) {
			const e = err as Error
			console.error(`GQL error ${e.name}:${e.message}; retrying in 10s`)
			await sleep(10_000)
			continue
		}

		let negligibleData = 0
		let placeholderMime = 0
		const candidates: GQLEdgeInterface[] = []

		for (const edge of page) {
			if (edge.node.data.size <= min_data_size) {
				negligibleData++
				continue
			}
			// placeholder so metaToRecord does not throw; libmagic decides the real MIME
			if (!edge.node.data.type && !edge.node.tags.some(t => t.name.toLowerCase() === 'content-type')) {
				placeholderMime++
				edge.node.data.type = PLACEHOLDER_MIME
			}
			candidates.push(edge)
		}

		const records = candidates.length === 0
			? []
			: await buildRecords(candidates, gql, 'classify-owner', 'goldsky', gqlBackup)

		return {
			pageNumber,
			gqlCount: page.length,
			negligibleData,
			placeholderMime,
			candidates: candidates.length,
			records,
			nextCursor: page.length ? page[page.length - 1]!.cursor : cursor,
			hasNextPage: pageInfo.hasNextPage,
		}
	}
}

const main = async () => {
	try {
		console.info(`owner: ${ownerArg}`)

		const total = await ownerTotalCount(ownerArg)
		console.info(`GQL total count: ${total.toLocaleString()}`)

		const listRes = await pool.query<OwnersListRecord>(
			'SELECT owner, last_update, infractions, add_method FROM owners_list WHERE owner = $1',
			[owner],
		)
		const ownersListRow = listRes.rows[0]
		const { abort, summary } = interpretOwnersList(ownersListRow)
		console.info(`owners_list: ${summary}`)

		const wlRes = await pool.query(
			'SELECT owner FROM owners_whitelist WHERE owner = $1',
			[owner],
		)
		if (wlRes.rowCount && wlRes.rowCount > 0) {
			console.info('owners_whitelist: yes (info only; does not change abort/proceed)')
		} else {
			console.info('owners_whitelist: no')
		}

		if (abort) {
			return
		}

		if (!(await confirmProceed())) {
			console.info('aborted by user')
			return
		}

		const totals = {
			pages: 0,
			metas: 0,
			negligibleData: 0,
			built: 0,
			queued: 0,
			notQueued: 0,
			errored: 0,
			notQueuedByReason: {} as Record<string, number>,
			placeholderMime: 0,
		}

		/**
		 * Pipeline: prepare page N+1 while downloads run; dispatch download batches
		 * with p-limit(20) across pages (same as indexer MAX_INGRESS_CONCURRENCY).
		 */
		let pageNumber = 1
		let prefetch: Promise<PreparedPage | null> = preparePage('', pageNumber).then(p => {
			// empty first response with no next page → done
			if (p.gqlCount === 0 && !p.hasNextPage) return null
			return p
		})
		const inflightDownloads: Promise<void>[] = []

		while (true) {
			const page = await prefetch
			if (!page) break

			totals.pages++
			totals.metas += page.gqlCount
			totals.negligibleData += page.negligibleData
			totals.placeholderMime += page.placeholderMime
			totals.built += page.records.length

			// kick off next page prepare while downloads are in flight
			prefetch = page.hasNextPage
				? preparePage(page.nextCursor, ++pageNumber)
				: Promise.resolve(null)

			if (page.records.length === 0) {
				console.info(
					`page ${page.pageNumber}: gql=${page.gqlCount} negligibleData=${page.negligibleData} `
					+ `placeholderMime=${page.placeholderMime} candidates=0 | totals queued=${totals.queued}/${total}`,
				)
				continue
			}

			inflightDownloads.push((async () => {
				const batches: TxRecord[][] = []
				for (let i = 0; i < page.records.length; i += DOWNLOAD_BATCH) {
					batches.push(page.records.slice(i, i + DOWNLOAD_BATCH))
				}

				const batchResults = await Promise.all(
					batches.map(batch => downloadLimit(() =>
						downloadWithChecks(batch, DOWNLOAD_TIMEOUT, chunkTxDataStream)
					)),
				)

				let pageQueued = 0
				let pageNotQueued = 0
				let pageErrored = 0
				const pageReasons: Record<string, number> = {}

				for (const results of batchResults) {
					for (const entry of results) {
						if (entry.queued === true) {
							pageQueued++
						} else if (entry.errorId) {
							pageErrored++
						} else {
							pageNotQueued++
							bumpReason(pageReasons, entry.record.data_reason)
							bumpReason(totals.notQueuedByReason, entry.record.data_reason)
						}
					}
				}

				totals.queued += pageQueued
				totals.notQueued += pageNotQueued
				totals.errored += pageErrored

				console.info(
					`page ${page.pageNumber}: gql=${page.gqlCount} negligibleData=${page.negligibleData} `
					+ `placeholderMime=${page.placeholderMime} candidates=${page.candidates} → built=${page.records.length} `
					+ `queued+${pageQueued} notQueued+${pageNotQueued} (${formatReasonMap(pageReasons)}) `
					+ `errored+${pageErrored} | totals queued=${totals.queued}/${total}`,
				)
			})())
		}

		await Promise.all(inflightDownloads)

		console.info('===== classify-owner complete =====')
		console.info(JSON.stringify({
			...totals,
			queuedOfTotal: `${totals.queued}/${total}`,
		}, null, 2))
	} finally {
		destroyGatewayAgent()
		destroyChunkStreamAgent()
		await destroyMimeWorkers()
		clearTimerHttpApiNodes()
		await pool.end()
	}
}

await main()
