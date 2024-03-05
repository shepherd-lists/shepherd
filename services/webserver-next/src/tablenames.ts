import knexCreate from '../../../libs/utils/knexCreate'

const knex = knexCreate()

export const txsTableNames = async (): Promise<string[]> => {
	return (await knex('information_schema.tables')
		.select('table_name')
		.where('table_schema', 'public')
		// eslint-disable-next-line no-useless-escape
		.where('table_name', 'like', '%\_txs')).map((row) => row.table_name)
}
