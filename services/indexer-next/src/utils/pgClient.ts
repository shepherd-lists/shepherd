import pg from 'pg'
import { slackLog } from './slackLog'


const DB_HOST = process.env.DB_HOST as string
console.info(`DB_HOST=${DB_HOST}`)
if (!DB_HOST) {
	slackLog('pgClient', 'DB_HOST is not defined')
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

//note: ok to ignore ssl cert (firewalls and a private network)
const pool = new pg.Pool({
	...config,
	ssl: process.env.NODE_ENV === 'test' ? false : {
		rejectUnauthorized: false,
	},
})

export default pool

