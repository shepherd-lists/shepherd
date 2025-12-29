import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex('states').insert({
		pname: 'indexer_ingest',
		value: 1727356711, //Thursday, 26-Sep-24 13:18:31 UTC
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex('states').where('pname', 'indexer_ingest').del()
}

