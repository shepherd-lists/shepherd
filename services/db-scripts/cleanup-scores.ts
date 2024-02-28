#!/usr/bin/env -S npx tsx
if(!process.env.DB_HOST) throw new Error('DB_HOST env var not set')
import { Pool, QueryResult } from 'pg'
import { performance } from 'perf_hooks'

const pool = new Pool({
	host: process.env.DB_HOST,
	port: 5432,
	user: 'postgres',
	password: 'postgres',
	database: 'arblacklist',
})

const run = async()=>{
	let res: QueryResult<never>
	let count = 0
	const limit = 1_000
	do {
		const t0 = performance.now()
		res = await pool.query(`update txs set top_score_value = null where txid in (select txid from txs where top_score_value > 0.9 and top_score_name = 'Neutral' limit ${limit});`)

		console.log(
			'rowCount', res.rowCount, count += (res.rowCount || 0),
			'duration', ((performance.now() - t0)/1000).toFixed(3), 'secs'
		)

	} while(res.rowCount && res.rowCount === limit )

	const check = await pool.query('select count(*) from txs where top_score_value > 0.9 and top_score_name = \'Neutral\';')
	console.log('check: remaining rows =', check.rows[0].count)

}

run().then(()=> pool.end() )