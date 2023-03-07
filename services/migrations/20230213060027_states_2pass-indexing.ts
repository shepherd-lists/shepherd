import { Knex } from "knex";
import { StateRecord } from "../src/common/shepherd-plugin-interfaces/types";


export async function up(knex: Knex): Promise<void> {
	await knex<StateRecord>('states').insert([ 
		{ pname: 'indexer_pass2', value: 0},
	])
	
	await knex('states').where({ pname: 'rating_position'}).delete()

	await knex('states').where({pname: "scanner_position"}).update({pname: 'indexer_pass1'})
}


export async function down(knex: Knex): Promise<void> {
	await knex<StateRecord>('states').where({ pname: 'indexer_pass2' }).delete()
	await knex('states').insert(
		{pname: 'rating_position', value: 0}
	)
	await knex('states').where({pname: "indexer_pass1"}).update({pname: 'scanner_position'})
}

