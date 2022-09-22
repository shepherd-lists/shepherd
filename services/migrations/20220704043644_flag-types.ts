import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		// some optional columns for flagged records
		table.text('flag_type') // e.g. 'test', 'match', 'classified'
		table.text('top_score_name')
		table.float('top_score_value') // consider creating separate scores table
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.dropColumn('flag_type')
		table.dropColumn('top_score_name')
		table.dropColumn('top_score_value')
	}) 
}

