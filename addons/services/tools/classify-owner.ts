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
import { ownerTotalCount } from '../libs/block-owner/owner-totalCount'
import { min_data_size } from '../libs/constants'
import { destroyChunkStreamAgent } from '../libs/chunkStreams/chunkFetch'
import { destroyGatewayAgent } from '../libs/chunkStreams/gatewayStream'
import { chunkTxDataStream } from '../libs/chunkStreams/chunkTxDataStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import pool from '../libs/utils/pgClient'
import type { OwnersListRecord } from '../types'
import { buildRecords } from '../services/indexer-next/src/index-shared/ingress/index'
import { downloadWithChecks, destroyMimeWorkers } from '../services/indexer-next/src/index-shared/ingress/downloadWithChecks'

const DOWNLOAD_TIMEOUT = 90_000
const DOWNLOAD_BATCH = 50
const ABORT_METHODS = new Set(['manual', 'updating', 'blocked'])
const PLACEHOLDER_MIME = 'application/octet-stream'

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

		let hasNextPage = true
		let cursor = ''

		while (hasNextPage) {
			let page: GQLEdgeInterface[] = []
			let nextPage = { hasNextPage: false }
			try {
				const { edges, pageInfo } = (await gql.run(ownerQuery, {
					owners: [ownerArg],
					cursor,
				})).data.transactions
				page = edges
				nextPage = pageInfo
			} catch (err: unknown) {
				const e = err as Error
				console.error(`GQL error ${e.name}:${e.message}; retrying in 10s`)
				await sleep(10_000)
				continue
			}

			totals.pages++
			totals.metas += page.length
			if (page.length) {
				cursor = page[page.length - 1]!.cursor
			}
			hasNextPage = nextPage.hasNextPage

			let pageNegligibleData = 0
			let pagePlaceholder = 0
			const candidates: GQLEdgeInterface[] = []

			for (const edge of page) {
				if (edge.node.data.size <= min_data_size) {
					pageNegligibleData++
					continue
				}
				// placeholder so metaToRecord does not throw; libmagic decides the real MIME
				if (!edge.node.data.type && !edge.node.tags.some(t => t.name.toLowerCase() === 'content-type')) {
					pagePlaceholder++
					edge.node.data.type = PLACEHOLDER_MIME
				}
				candidates.push(edge)
			}

			totals.negligibleData += pageNegligibleData
			totals.placeholderMime += pagePlaceholder

			if (candidates.length === 0) {
				console.info(
					`page ${totals.pages}: gql=${page.length} negligibleData=${pageNegligibleData} `
					+ `placeholderMime=${pagePlaceholder} candidates=0 | totals queued=${totals.queued}/${total}`,
				)
				continue
			}

			const records = await buildRecords(
				candidates,
				gql,
				'classify-owner',
				'goldsky',
				gqlBackup,
			)
			totals.built += records.length

			let pageQueued = 0
			let pageNotQueued = 0
			let pageErrored = 0
			const pageReasons: Record<string, number> = {}

			for (let i = 0; i < records.length; i += DOWNLOAD_BATCH) {
				const batch = records.slice(i, i + DOWNLOAD_BATCH)
				const results = await downloadWithChecks(batch, DOWNLOAD_TIMEOUT, chunkTxDataStream)
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
				`page ${totals.pages}: gql=${page.length} negligibleData=${pageNegligibleData} `
				+ `placeholderMime=${pagePlaceholder} candidates=${candidates.length} → built=${records.length} `
				+ `queued+${pageQueued} notQueued+${pageNotQueued} (${formatReasonMap(pageReasons)}) `
				+ `errored+${pageErrored} | totals queued=${totals.queued}/${total}`,
			)
		}

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
