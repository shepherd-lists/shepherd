import 'dotenv/config'

if (!process.env.DB_HOST) throw new Error('DB_HOST env var not set')

const days = parseInt(process.argv[2], 10)
if (!days) {
	console.error('Usage: npx tsx query-unflagged-txids.ts <days>')
	process.exit(1)
}

import pg from '../libs/utils/pgClient'

try {
	const { rows } = await pg.query(
		`SELECT txid, content_type, content_size, height, parent, parents, owner
		 FROM txs
		 WHERE flagged IS NULL
			 AND last_update_date >= NOW() - make_interval(days => $1)`,
		[days]
	)

	console.log(JSON.stringify(rows, null, 2))
	console.error(`${rows.length} unflagged records (last ${days} days)`)

} finally {
	await pg.end()
}
