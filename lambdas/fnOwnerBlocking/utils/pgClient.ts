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

export default pool

export const batchInsert = async <T extends object>(records: T[], tableName: string) => {
	console.info(`batchInsert inserting  ${records.length} records.`)
	if (records.length === 0) return

	/** we'll be using the placeholder method where data is sent separately AKA parameterized query.
	 * e.g. 
	 * query: INSERT INTO "ownerTable" ("owner", "txid", "parent", "parents") VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)
	 * data: [owner1, txid1, parent1, parents1, owner2, txid2, parent2, parents2, owner3, txid3, parent3, parents3]
	*/
	const columns = Object.keys(records[0]).map(k => `"${k}"`).join(', ')

	try {
		await pool.query('BEGIN')
		let index = 0
		const query = `INSERT INTO "${tableName}" (${columns}) `
			+ `VALUES `
			+ records.map(r => `(${Object.keys(r).map(() => '$' + ++index).join(', ')})`).join(', ')
			+ ' RETURNING *'

		console.debug('query', query)

		const values = records.map(r => Object.values(r)).flat()

		console.debug('values', values)

		const res = await pool.query(query, values) // query is a template string, values is an array

		console.debug(`batch inserted ${res.rowCount} records`)

		await pool.query('COMMIT')
		return res.rowCount;
	} catch (err: unknown) {
		const e = err as Error
		console.error(`pg-error: ${e.name} ${e.message}`)
		await pool.query('ROLLBACK')
		throw e
	}
}

/** we can't use `-` in postgres table names, and usual starting character rules */
export const ownerToTablename = (owner: string) => `owner_${owner.replace(/-/g, '·')}`
export const tablenameToOwner = (tablename: string) => tablename.slice('owner_'.length).replace(/·/g, '-')

