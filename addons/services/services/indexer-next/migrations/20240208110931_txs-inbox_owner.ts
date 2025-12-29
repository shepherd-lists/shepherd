import type { Knex } from 'knex'


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('inbox', (table) => {
		table.specificType('owner', 'char(43)')
	})
	await knex.schema.alterTable('txs', (table) => {
		table.specificType('owner', 'char(43)')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('inbox', (table) => {
		table.dropColumn('owner')
	})
	await knex.schema.alterTable('txs', (table) => {
		table.dropColumn('owner')
	})
}

