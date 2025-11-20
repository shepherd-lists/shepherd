import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex('states').insert({
		pname: 'owner_ingest',
		value: 1709307000, //Fri Mar 01 2024 15:30:00 GMT
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex('states').where('pname', 'owner_ingest').del()
}

