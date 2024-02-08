#!/usr/bin/env -S npx tsx
if(!process.env.DB_HOST) throw new Error('DB_HOST env var not set')
import { Pool, QueryResult } from 'pg'

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
	do {
		res = await pool.query('update txs set top_score_value = null where txid in (select txid from txs where top_score_value > 0.9 and top_score_name = \'Neutral\' limit 10000);')

		console.log( 'rowCount', res.rowCount, count += (res.rowCount || 0) )

	} while(res.rowCount && res.rowCount > 0 )
}

run().then(()=> pool.end() )