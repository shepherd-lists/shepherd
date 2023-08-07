import knexCreate from '../common/utils/db-connection'

const knex = knexCreate()

export const txsTableNames = async (): Promise<string[]> => {
	return (await knex('information_schema.tables')
	.select('table_name')
	.where('table_schema', 'public')
	.where('table_name', 'like', '%\_txs')).map((row) => row.table_name)
}
