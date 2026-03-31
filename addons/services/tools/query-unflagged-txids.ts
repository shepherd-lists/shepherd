import 'dotenv/config'

if (!process.env.DB_HOST) throw new Error('DB_HOST env var not set')

const fromDays = parseInt(process.argv[2], 10)
const toDays = parseInt(process.argv[3], 10) || 0
if (!fromDays) {
	console.error('Usage: npx tsx query-unflagged-txids.ts <fromDays> [toDays]')
	process.exit(1)
}

import pg from '../libs/utils/pgClient'

try {
	const { rows } = await pg.query(
		`SELECT txid, content_type, content_size, height, parent, parents, owner
		 FROM txs
		 WHERE flagged IS NULL
			 AND last_update_date >= NOW() - make_interval(days => $1)
			 AND last_update_date <= NOW() - make_interval(days => $2)`,
		[fromDays, toDays]
	)

	console.log(JSON.stringify(rows, null, 2))
	console.error(`${rows.length} unflagged records (${fromDays} to ${toDays} days ago)`)

} finally {
	await pg.end()
}
