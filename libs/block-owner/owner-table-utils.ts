import pool from '../utils/pgClient'

/** we can't use `-` in postgres table names, and usual starting character rules + 63 char limit */
export const ownerToOwnerTablename = (owner: string) => `owner_${owner.replace(/-/g, '~')}` // ref fnOwnerTable

export const ownerToInfractionsTablename = (owner: string) => `infractions_${owner.replace(/-/g, '~')}`

export const tablenameToOwner = (tablename: string) => {
	if (tablename.startsWith('owner_')) return tablename.slice('owner_'.length).replace(/~/g, '-')
	if (tablename.startsWith('infractions_')) return tablename.slice('infractions_'.length).replace(/~/g, '-')
	throw new Error('invalid tablename')
}

// /** N.B. this has been moved to http-flagged */
// export const createInfractionsTable = async (owner: string, trx?: Knex.Transaction) => {


export const dropOwnerTables = async (owner: string) => {
	await pool.query(`DROP TABLE IF EXISTS "${[ownerToOwnerTablename(owner)]}"`)
	await pool.query(`DROP TABLE IF EXISTS "${[ownerToInfractionsTablename(owner)]}"`)
}

export const createOwnerTable = async (owner: string) => {
	const tablename = ownerToOwnerTablename(owner)

	const tableExists = await pool.query<{ exists: boolean }>(
		'SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = $1)',
		[tablename]
	)
	if (tableExists.rows[0].exists) return tablename

	await pool.query(`
		CREATE TABLE "${tablename}" (
			txid CHAR(43),
			parent CHAR(43),
			parents CHAR(43)[],
			byte_start BIGINT,
			byte_end BIGINT,
			last_update TIMESTAMP with time zone DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (txid)
		);	
	`)

	return tablename
}
