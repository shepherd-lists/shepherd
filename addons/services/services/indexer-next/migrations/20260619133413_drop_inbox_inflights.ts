import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists('inflights')
	await knex.schema.dropTableIfExists('inbox')
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.createTable('inbox', (table) => {
		table.specificType('txid', 'char(43)').notNullable()
		table.text('content_type').notNullable()
		table.bigInteger('content_size').notNullable()
		table.boolean('flagged')
		table.boolean('valid_data')
		table.text('data_reason')
		table.timestamp('last_update_date', { useTz: true })
		table.integer('height')
		table.text('flag_type')
		table.text('top_score_name')
		table.specificType('top_score_value', 'real')
		table.specificType('parent', 'char(43)')
		table.bigInteger('byte_start')
		table.bigInteger('byte_end')
		table.specificType('parents', 'char(43)[]')
		table.specificType('owner', 'char(43)')
		table.primary(['txid'], { constraintName: 'inbox_txs_pkey' })
	})
	// constraints + indexes with their current names
	await knex.schema.raw('ALTER TABLE inbox ADD CONSTRAINT cc_txid CHECK (char_length(txid) = 43)')
	await knex.schema.raw('CREATE INDEX inbox_txs_flagged_idx ON inbox (flagged) WHERE flagged = true')
	await knex.schema.raw('CREATE INDEX inbox_txs_flagged_idx1 ON inbox (flagged) WHERE flagged IS NULL')
	await knex.schema.raw('CREATE INDEX inbox_txs_height_idx ON inbox (height)')
	await knex.schema.raw('CREATE INDEX inbox_txs_top_score_value_idx ON inbox (top_score_value DESC NULLS LAST)')
	await knex.schema.raw('CREATE INDEX inbox_txs_valid_data_idx ON inbox (valid_data) WHERE valid_data IS NULL')
	await knex.schema.raw('ALTER TABLE inbox SET (fillfactor = 50)')

	await knex.schema.createTable('inflights', (table) => {
		table.specificType('txid', 'char(43)').notNullable()
		table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now())
		table.primary(['txid'], { constraintName: 'inflights_pkey' })
		table.index(['txid'], 'inflights_txid_index')
		table.foreign('txid', 'inflights_txid_foreign').references('inbox.txid')
	})
	await knex.schema.raw('ALTER TABLE inflights SET UNLOGGED')
}

