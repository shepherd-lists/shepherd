import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('owners_whitelist', (table) => {
		table.string('owner').primary()
		table.dateTime('last_update').defaultTo(knex.fn.now())
	})
	await knex.schema.createTable('owners_list', (table) => {
		table.string('owner').primary()
		table.dateTime('last_update').defaultTo(knex.fn.now())
		table.integer('infractions').defaultTo(0).index()
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTable('owners_whitelist')
	await knex.schema.dropTable('owners_list')
}

