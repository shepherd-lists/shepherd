import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.raw('CREATE INDEX IF NOT EXISTS txs_valid_data_idx ON txs(valid_data) WHERE valid_data IS NULL;')
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.dropIndex('valid_data', 'txs_valid_data_idx')
	})
}

