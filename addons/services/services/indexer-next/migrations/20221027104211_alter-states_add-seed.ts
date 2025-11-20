import { Knex } from "knex";

interface StateRecord {
	pname: 'indexer_pass1' | 'indexer_pass2' | 'seed_position' | 'owner_ingest'
	value: number
}

export async function up(knex: Knex): Promise<void> {
	await knex<StateRecord>('states').insert([
		{ pname: 'seed_position', value: 0 },
	])
}


export async function down(knex: Knex): Promise<void> {
	await knex<StateRecord>('states').where({ pname: 'seed_position' }).delete()
}

