import { Knex } from "knex";
import { StateRecord } from '../src/common/shepherd-plugin-interfaces/types' 

export async function up(knex: Knex): Promise<void> {
	await knex<StateRecord>('states').insert([ 
		{ pname: 'seed_position', value: 0},
	])
}


export async function down(knex: Knex): Promise<void> {
	await knex<StateRecord>('states').where({ pname: 'seed_position' }).delete()
}

