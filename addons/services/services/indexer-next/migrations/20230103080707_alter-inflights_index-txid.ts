import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('inflights', (table) => {
		table.index('txid')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('inflights', (table) => {
		table.dropIndex('txid')
	})
}

