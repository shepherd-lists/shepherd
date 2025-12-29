import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.renameTable('inbox_txs', 'inbox')
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.renameTable('inbox', 'inbox_txs')
}

