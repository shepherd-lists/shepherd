import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.specificType('parent', 'char(43)')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.dropColumn('parent')
	})
}

