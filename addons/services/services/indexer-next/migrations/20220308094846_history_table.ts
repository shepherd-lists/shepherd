import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('history', (table) => {
		table.bigIncrements('id')
		table.timestamp('datetime', { useTz: true }).defaultTo(knex.fn.now())
		table.bigInteger('total_txs').notNullable()
		table.bigInteger('unflagged').notNullable()
		table.integer('scanner_position')
		table.integer('gql_height')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists('history')
}

