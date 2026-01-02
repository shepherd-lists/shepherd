import pg from 'pg'
import { slackLog } from './slackLog'
import { TxRecord } from 'shepherd-plugin-interfaces/types'


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
	max: 200,
	idleTimeoutMillis: 30_000,
}

//note: ok to ignore ssl cert (firewalls and a private network)
const pool = new pg.Pool({
	...config,
	ssl: process.env.NODE_ENV === 'test' ? false : {
		rejectUnauthorized: false,
	},
})

export default pool

export const batchInsert = async <T extends object>(records: T[], tableName: string) => {
	console.info(`batchInsert inserting ${records.length} records.`)
	if (records.length === 0) return

	/** we'll be using the placeholder method where data is sent separately AKA parameterized query.
	 * e.g. 
	 * query: INSERT INTO "ownerTable" ("owner", "txid", "parent", "parents") VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)
	 * data: [owner1, txid1, parent1, parents1, owner2, txid2, parent2, parents2, owner3, txid3, parent3, parents3]
	*/
	const columns = Object.keys(records[0]).map(k => `"${k}"`).join(', ')

	let index = 0
	const query = `INSERT INTO "${tableName}" (${columns}) `
		+ `VALUES `
		+ records.map(r => `(${Object.keys(r).map(() => '$' + ++index).join(', ')})`).join(', ')
		+ ' RETURNING *'

	const values = records.map(r => Object.values(r)).flat()

	console.debug('query', query)
	console.debug('values', JSON.stringify(values, null, 2))

	try {

		const res = await pool.query(query, values) // query is a template string, values is an array. 1 single query

		console.debug(`batch inserted ${res.rowCount} records`)

		return res.rowCount;
	} catch (err: unknown) {
		const e = err as Error
		console.error(`pg-error: ${e.name} ${e.message}`)
		throw e
	}
}

/** similar to batchInsert, but with merge rules
 * merge rules:
 * flagged: once true, always stays true. (important! flagged files will become 404!)
 * byte_start/byte_end: don't overwrite valid values with null or -1.
 * other columns: only update if not null.
 * dont update unchanged records (where clause)
 */
export const batchUpsertTxsWithRules = async (records: TxRecord[], tableName: string = 'txs') => {
	console.info(batchUpsertTxsWithRules.name, `upserting ${records.length} records.`)
	if (records.length === 0) return

	//n.b. the keys are derived from the first record
	const columns = Object.keys(records[0]).map(k => `"${k}"`).join(', ')

	let index = 0
	const query = `INSERT INTO "${tableName}" (${columns}) `
		+ `VALUES `
		+ records.map(r => `(${Object.keys(r).map(() => '$' + ++index).join(', ')})`).join(', ')
		+ ' ON CONFLICT ("txid") DO UPDATE SET '
		+ Object.keys(records[0])
			.filter(k => k !== 'txid')
			.map(k => {
				//preserve flagged=true
				if (k === 'flagged') {
					return `"${k}" = CASE WHEN "${tableName}"."flagged" = true THEN true ELSE EXCLUDED."${k}" END`
				}
				//don't overwrite valid values with null or -1
				if (k === 'byte_start' || k === 'byte_end') {
					return `"${k}" = CASE WHEN EXCLUDED."${k}" IS NOT NULL AND EXCLUDED."${k}"::bigint != -1 THEN EXCLUDED."${k}" ELSE "${tableName}"."${k}" END`
				}
				//other columns: only update if not null
				return `"${k}" = CASE WHEN EXCLUDED."${k}" IS NOT NULL THEN EXCLUDED."${k}" ELSE "${tableName}"."${k}" END`
			})
			.join(', ')
		+ ' WHERE '
		+ Object.keys(records[0])
			.filter(k => k !== 'txid')
			.map(k => `"${tableName}"."${k}" IS DISTINCT FROM EXCLUDED."${k}"`).join(' OR ')
		+ ' RETURNING *';

	const values = records.map(r => Object.values(r)).flat()

	console.debug('query', query)
	console.debug('values', JSON.stringify(values, null, 2))

	try {
		const res = await pool.query(query, values)

		console.debug(`batch upserted ${res.rowCount} records`)
		return res.rows;
	} catch (err: unknown) {
		const e = err as Error
		console.error(`pg-error: ${e.name} ${e.message}`)
		throw e
	}
}

