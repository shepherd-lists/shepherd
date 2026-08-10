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
import { slackLog } from '../libs/utils/slackLog'
import type { OwnersListRecord } from '../types'
import type { TxRecord } from 'shepherd-plugin-interfaces/types'
import { buildRecords } from '../services/indexer-next/src/index-shared/ingress/index'
import { downloadWithChecks, destroyMimeWorkers } from '../services/indexer-next/src/index-shared/ingress/downloadWithChecks'

/** Match indexer-next query-processor: CHUNKS_BATCH_SIZE / MAX_INGRESS_CONCURRENCY */
const DOWNLOAD_TIMEOUT = 90_000
const DOWNLOAD_BATCH = 50
const MAX_INGRESS_CONCURRENCY = 20
const RETRY_MS = 10_000
const ABORT_METHODS = new Set(['manual', 'updating', 'blocked'])
const PLACEHOLDER_MIME = 'application/octet-stream'

const buildLimit = pLimit(MAX_INGRESS_CONCURRENCY)
const downloadLimit = pLimit(MAX_INGRESS_CONCURRENCY)

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
const gqlPrimary = process.env.GQL_URL_SECONDARY as string
const gqlFallback = process.env.GQL_URL as string
const gql = arGql({ endpointUrl: gqlPrimary, retries: 3 })
const gqlBackup = arGql({ endpointUrl: gqlFallback, retries: 3 })

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Keep retrying until fn succeeds. Long-running tool: everything works eventually. */
const retryUntil = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
	while (true) {
		try {
			return await fn()
		} catch (err: unknown) {
			const e = err as Error
			await slackLog(
				'classify-owner', ownerArg, label,
				`${e.name}:${e.message}; retrying in ${RETRY_MS / 1000}s`,
			)
			await sleep(RETRY_MS)
		}
	}
}

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

/** GQL fetch + filter for one page (no buildRecords). Retries the same cursor on GQL errors. */
const fetchPage = async (cursor: string): Promise<{
	gqlCount: number
	negligibleData: number
	placeholderMime: number
	candidates: GQLEdgeInterface[]
	nextCursor: string
	hasNextPage: boolean
}> => {
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
			await slackLog(
				'classify-owner', ownerArg, 'gql-fetch',
				`${e.name}:${e.message}; retrying in ${RETRY_MS / 1000}s`,
			)
			await sleep(RETRY_MS)
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

		return {
			gqlCount: page.length,
			negligibleData,
			placeholderMime,
			candidates,
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
		 * Overlapping pipeline: fetch schedules buildLimit(page); each build schedules
		 * downloadLimit(batches). Stages run concurrently under the two pLimits.
		 */
		const inflightBuilds: Promise<void>[] = []
		const inflightDownloads: Promise<void>[] = []
		let cursor = ''
		let pageNumber = 0

		while (true) {
			pageNumber++
			const page = await fetchPage(cursor)
			totals.pages++
			totals.metas += page.gqlCount
			totals.negligibleData += page.negligibleData
			totals.placeholderMime += page.placeholderMime

			console.info(
				`fetch page ${pageNumber}: gql=${page.gqlCount} negligibleData=${page.negligibleData} `
				+ `placeholderMime=${page.placeholderMime} candidates=${page.candidates.length} `
				+ `| builds=${inflightBuilds.length} downloads=${inflightDownloads.length}`,
			)

			if (page.candidates.length > 0) {
				const pageCandidates = page.candidates
				const builtPageNumber = pageNumber
				inflightBuilds.push(buildLimit(async () => {
					const records = await retryUntil(`build page ${builtPageNumber}`, () =>
						buildRecords(pageCandidates, gql, 'classify-owner', 'goldsky', gqlBackup),
					)
					totals.built += records.length
					console.info(
						`built page ${builtPageNumber}: records=${records.length} | totals built=${totals.built}`,
					)

					for (let i = 0; i < records.length; i += DOWNLOAD_BATCH) {
						const batch = records.slice(i, i + DOWNLOAD_BATCH)
						inflightDownloads.push(downloadLimit(async () => {
							let pending: TxRecord[] = batch
							let queued = 0
							let notQueued = 0
							const reasons: Record<string, number> = {}

							while (pending.length > 0) {
								const results = await retryUntil(
									`download page ${builtPageNumber} batch(${pending.length})`,
									() => downloadWithChecks(pending, DOWNLOAD_TIMEOUT, chunkTxDataStream),
								)
								const retry: TxRecord[] = []
								for (const entry of results) {
									if (entry.queued === true) {
										queued++
									} else if (entry.errorId) {
										retry.push(entry.record)
									} else {
										notQueued++
										bumpReason(reasons, entry.record.data_reason)
										bumpReason(totals.notQueuedByReason, entry.record.data_reason)
									}
								}
								if (retry.length === 0) break
								await slackLog(
									'classify-owner', ownerArg,
									`download page ${builtPageNumber}`,
									`${retry.length}/${pending.length} errored; retrying in ${RETRY_MS / 1000}s`,
								)
								await sleep(RETRY_MS)
								pending = retry
							}

							totals.queued += queued
							totals.notQueued += notQueued
							console.info(
								`download page ${builtPageNumber} batch: size=${batch.length} `
								+ `queued+${queued} notQueued+${notQueued} (${formatReasonMap(reasons)}) `
								+ `| totals queued=${totals.queued}/${total}`,
							)
						}))
					}
				}))
			}

			if (!page.hasNextPage || page.gqlCount === 0) break
			cursor = page.nextCursor
		}

		await Promise.all(inflightBuilds)
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
