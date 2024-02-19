import pg from 'pg'


const DB_HOST = process.env.DB_HOST as string
console.log('DB_HOST', DB_HOST)
if (!DB_HOST) {
	console.error({ logType: 'error', message: 'DB_HOST is not defined' })
}

const config: pg.PoolConfig = {
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

export default pool

