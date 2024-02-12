import pg from 'pg'
// import { logJson } from './logJson'


const DB_HOST = process.env.DB_HOST as string
console.log('DB_HOST', DB_HOST)
if (!DB_HOST) {
	console.error({ logType: 'error', message: 'DB_HOST is not defined' })
}

const config = {
	host: process.env.DB_HOST,
	port: 5432,
	user: 'postgres',
	password: 'postgres',
	database: 'arblacklist',
	max: 10,
	idleTimeoutMillis: 120_000,
}


const pool = new pg.Pool({
	...config,
	ssl: {
		rejectUnauthorized: false, //ignore ssl cert (firewalls and a private network)
	},
})


pool.on('error', (e, client) => {
	console.error({ logType: 'error', message: `pg-error: ${e.message} ${e.stack}` })
})


export default pool

