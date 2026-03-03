/**
 * Insert reported txids into the `reported_txids` table.
 *
 * Usage:
 *   npx tsx reported-txids.ts <txid1> <txid2> ...
 *
 * Required env vars: DB_HOST, GQL_URL_SECONDARY (or defaults to goldsky)
 */
import 'dotenv/config'
import { arGql, GQLUrls } from 'ar-gql'
import knexCreate from '../libs/utils/knexCreate'

const [, , ...txids] = process.argv

if (!txids.length) {
	console.error('Usage: npx tsx reported-txids.ts <txid1> <txid2> ...')
	process.exit(1)
}

const gql = arGql({ endpointUrl: GQLUrls.goldsky, retries: 3 })
const knex = knexCreate()

const BATCH_SIZE = 100

try {
	console.info(`Processing ${txids.length} txids using ${gql.endpointUrl} ...`)

	for (let i = 0; i < txids.length; i += BATCH_SIZE) {
		const batch = txids.slice(i, i + BATCH_SIZE)

		const query = `
		query($ids: [ID!]) {
			transactions(ids: $ids, first: ${BATCH_SIZE}) {
				edges {
					node {
						id
						owner { address }
					}
				}
			}
		}`
		const res = await gql.run(query, { ids: batch })
		const edges: { node: { id: string; owner: { address: string } } }[] = res.data.transactions.edges

		const found = new Map(edges.map(e => [e.node.id, e.node.owner.address]))

		const missing = batch.filter(id => !found.has(id))
		if (missing.length) {
			console.warn(`Warning: ${missing.length} txids not found in GQL:`, missing)
		}

		if (!found.size) continue

		const rows = [...found.entries()].map(([txid, owner]) => ({ txid, owner }))

		await knex('reported_txids')
			.insert(rows)
			.onConflict('txid')
			.merge({ last_update: knex.fn.now() })

		console.info(`Inserted ${rows.length} rows (batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(txids.length / BATCH_SIZE)})`)
	}

	console.info('Done.')
} finally {
	await knex.destroy()
}
