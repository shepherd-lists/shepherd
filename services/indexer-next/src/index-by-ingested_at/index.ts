import pool from '../../../../libs/utils/pgClient'


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
) => {

	const lastMax = await readPosition()
	console.debug('indexer_ingest position', lastMax)


}

