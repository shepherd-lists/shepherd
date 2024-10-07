import pool from '../../../../libs/utils/pgClient'
import { performance } from 'perf_hooks'
import { gqlPages } from '../index-by-height/query-processor'


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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
			}
		}
	}
}
`

const indexName = 'indexer_ingest'

const readPositionOrig = async () => (await pool.query(`SELECT value FROM states WHERE pname = 'indexer_ingest'`)).rows[0].value

export const ingestLoop = async (
	readPosition = readPositionOrig,
	loop = true,
) => {

	const lastMax = await readPosition()
	console.info(indexName, 'lastMax position', lastMax)

	const interval = 30 // seconds
	const sleepMs = 1_000

	//last values for vars
	let maxAt = lastMax
	let minAt = lastMax - interval + 1

	do {
		/** update ingest boundaries before next run */
		minAt = maxAt + 1
		maxAt += interval

		/** init stat outputs */
		const counts = { page: 0, items: 0, inserts: 0 }

		/** wait until next interval to run */
		const t0 = performance.now()
		while (Date.now() < maxAt * 1000) {
			await sleep(sleepMs)
		}
		const t1 = performance.now()
		console.info(indexName, `begin query after waiting ${(t1 - t0).toFixed(0)}ms`, { minAt, maxAt })

		/** call the query processor */
		await gqlPages({
			query: ingestQuery,
			variables: {
				minAt, maxAt,
			},
			gqlUrl: process.env.GQL_URL_SECONDARY!, // goldsky
			gqlUrlBackup: process.env.GQL_URL!, // arweave.net
			indexName,
		})

		/** update state */
		await pool.query('UPDATE states SET value = $1 WHERE pname = $2', [maxAt, indexName])


	} while (loop)

}
