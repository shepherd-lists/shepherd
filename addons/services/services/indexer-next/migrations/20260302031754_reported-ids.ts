import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('reported_txids', (table) => {
		table.specificType('txid', 'char(43)').primary()
		table.specificType('owner', 'char(43)').notNullable() //SELECT DISTINCT owner FROM reported_txids
		table.dateTime('last_update').defaultTo(knex.fn.now())
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('reported_txids')
}

