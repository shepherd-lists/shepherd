import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('txs', (table)=>{
		table.bigIncrements('id')
		table.string('txid', 43).unique().notNullable()
		table.string('content_type').notNullable()
		table.string('content_size').notNullable()
		table.boolean('flagged')
		table.boolean('valid_data')
		table.boolean('data_reason')

		table.float('nsfw_porn')
		table.float('nsfw_sexy')
		table.float('nsfw_hentai')
		table.float('nsfw_neutral')
		table.float('nsfw_drawings')

		table.timestamp('last_update_date', { useTz: true }).defaultTo(knex.fn.now())
	})
	await knex.schema.raw('ALTER TABLE txs ADD CONSTRAINT cc_txid CHECK ((char_length(txid) = 43))')

	/**
	 * Remove all that dbowner stuff
	 */

	await knex.schema.createTable('states', table=> {
		table.increments('id')
		table.text('pname').notNullable()
		table.bigInteger('value').notNullable()
	})
	await knex('states').insert([
		{ pname: 'scanner_position', value: 0},
		{ pname: 'rating_position', value: 0},
	])
}


export async function down(knex: Knex): Promise<void> {
	//this seems dangerous?
	await knex.schema.dropTableIfExists('txs')
	await knex.schema.dropTableIfExists('states')
}

