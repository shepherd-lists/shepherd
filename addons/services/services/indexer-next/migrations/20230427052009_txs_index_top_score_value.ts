import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.raw('CREATE INDEX IF NOT EXISTS txs_top_score_value_desc ON txs(top_score_value DESC NULLS LAST);')
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.dropIndex('top_score_value', 'txs_top_score_value_desc')
	})
}

