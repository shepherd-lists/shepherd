import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('owners_list', (table) => {
		table.text('add_method').notNullable()
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('owners_list', (table) => {
		table.dropColumn('add_method')
	})
}

