import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', (table) => {
		table.renameColumn('byteStart', 'byte_start')
		table.renameColumn('byteEnd', 'byte_end')
	})
	await knex.schema.alterTable('inbox', (table) => {
		table.renameColumn('byteStart', 'byte_start')
		table.renameColumn('byteEnd', 'byte_end')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', (table) => {
		table.renameColumn('byte_start', 'byteStart')
		table.renameColumn('byte_end', 'byteEnd')
	})
	await knex.schema.alterTable('inbox', (table) => {
		table.renameColumn('byte_start', 'byteStart')
		table.renameColumn('byte_end', 'byteEnd')
	})
}

