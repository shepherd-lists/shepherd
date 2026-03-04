import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('reported_txids', (table) => {
		table.index('owner')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('reported_txids', (table) => {
		table.dropIndex('owner')
	})
}

