import knexCreate from '../common/utils/db-connection'

const knex = knexCreate()

export const tablesnames = async () => {
	return knex('information_schema.tables')
	.select('table_name')
	.where('table_name', 'like', '%\_txs')
}