import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('reported_txids', (table) => {
		table.specificType('owner', 'char(43)').nullable().alter()
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('reported_txids', (table) => {
		table.specificType('owner', 'char(43)').notNullable().alter()
	})
}

