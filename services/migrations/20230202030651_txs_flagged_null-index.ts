import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.raw('CREATE INDEX txs_flagged_null ON txs(flagged) WHERE flagged IS NULL;')
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table =>{
		table.dropIndex('flagged', 'txs_flagged_null')
	})
}

