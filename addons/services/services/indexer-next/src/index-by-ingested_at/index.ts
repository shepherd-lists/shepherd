import pool from '../../../../libs/utils/pgClient'
import { performance } from 'perf_hooks'
import { gqlPages } from '../index-shared/query-processor'


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const LIVE_INTERVAL_SEC = 30
const BACKSYNC_INTERVAL_SEC = 300 // 5 min — 10× live step during backsync
const BACKSYNC_LAG_THRESHOLD_SEC = 3600 // switch to live when within 1 hr of tip
const sleepMs = 1_000

export type IngestIntervalConfig = {
	liveIntervalSec: number
	backsyncIntervalSec: number
	backsyncLagThresholdSec: number
}

export const DEFAULT_INGEST_INTERVALS: IngestIntervalConfig = {
	liveIntervalSec: LIVE_INTERVAL_SEC,
	backsyncIntervalSec: BACKSYNC_INTERVAL_SEC,
	backsyncLagThresholdSec: BACKSYNC_LAG_THRESHOLD_SEC,
}

export const pickIngestInterval = ({
	nowSec,
	positionSec,
	liveIntervalSec = LIVE_INTERVAL_SEC,
	backsyncIntervalSec = BACKSYNC_INTERVAL_SEC,
	backsyncLagThresholdSec = BACKSYNC_LAG_THRESHOLD_SEC,
}: {
	nowSec: number
	positionSec: number
	liveIntervalSec?: number
	backsyncIntervalSec?: number
	backsyncLagThresholdSec?: number
}) => {
	const lag = nowSec - positionSec
	return lag > backsyncLagThresholdSec ? backsyncIntervalSec : liveIntervalSec
}

export const ingestLagMode = (
	lagSec: number,
	backsyncLagThresholdSec = BACKSYNC_LAG_THRESHOLD_SEC,
): 'backsync' | 'live' => (lagSec > backsyncLagThresholdSec ? 'backsync' : 'live')

const ingestQuery = `
query($cursor: String, $minAt: Int, $maxAt: Int) {
	transactions(
		# your query parameters

		ingested_at: {
			min: $minAt,
			max: $maxAt,
		}
		#remove pending results
		sort: HEIGHT_DESC

		tags: [
			{ name: "Content-Type", values: ["video/*", "image/*"], match: WILDCARD}
		]
		
		# standard template below
		after: $cursor
		first: 100
	) {
		pageInfo{hasNextPage}
		edges {
			cursor
			node {
				# what tx data you want to query for:
				id
				id
				data{ size type }
				tags{ name value }
				block{ height }
				parent{ id }
				owner{ address }
				ingested_at
			}
		}
	}
}
`

const indexName = 'indexer_ingest'

const readPositionOrig = async () => (await pool.query(`SELECT value FROM states WHERE pname = 'indexer_ingest'`)).rows[0].value

export type IngestLoopOptions = {
	now?: () => number
	intervals?: Partial<IngestIntervalConfig>
}

export const ingestLoop = async (
	readPosition = readPositionOrig,
	loop = true,
	options: IngestLoopOptions = {},
) => {

	const lastMax = await readPosition()
	console.info(indexName, 'lastMax position', lastMax)

	const nowFn = options.now ?? (() => Date.now())
	const intervals: IngestIntervalConfig = { ...DEFAULT_INGEST_INTERVALS, ...options.intervals }

	//last values for vars
	let maxAt = lastMax
	let minAt = lastMax - LIVE_INTERVAL_SEC + 1

	do {
		const nowSec = Math.floor(nowFn() / 1000)
		const lagSec = nowSec - maxAt
		const interval = pickIngestInterval({ nowSec, positionSec: maxAt, ...intervals })
		const mode = ingestLagMode(lagSec, intervals.backsyncLagThresholdSec)

		/** update ingest boundaries before next run */
		minAt = maxAt + 1
		maxAt += interval
		maxAt = Math.min(maxAt, nowSec)

		/** init stat outputs */
		const counts = { page: 0, items: 0, inserts: 0 }

		/** wait until next interval to run */
		const t0 = performance.now()
		while (nowFn() < maxAt * 1000) {
			await sleep(sleepMs)
		}
		const t1 = performance.now()
		console.info(indexName, `begin query after waiting ${(t1 - t0).toFixed(0)}ms`, JSON.stringify({ mode, interval, lagSec, minAt, maxAt }))

		/** call the query processor */
		await gqlPages({
			query: ingestQuery,
			variables: {
				minAt, maxAt,
			},
			gqlUrl: process.env.GQL_URL_SECONDARY!, // goldsky
			gqlUrlBackup: process.env.GQL_URL!, // arweave.net
			indexName,
			streamSourceName: 'nodes',
		})

		/** update state */
		await pool.query('UPDATE states SET value = $1 WHERE pname = $2', [maxAt, indexName])


	} while (loop)

}
