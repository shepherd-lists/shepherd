import pool from './pgClient'


export const addonTxsTableNames = async (): Promise<string[]> => {
	const query = 'SELECT table_name FROM information_schema.tables WHERE table_schema=\'public\' AND table_name like \'%_txs\''
	const result = await pool.query(query)
	console.info(addonTxsTableNames.name, result.rows.map(row => row.table_name))
	return result.rows.map(row => row.table_name)
}

