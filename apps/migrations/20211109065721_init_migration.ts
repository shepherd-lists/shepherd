import { Knex } from "knex";

//insert into knex_migrations(name, batch, migration_time) values('20211109065721_init_migration.ts', 1, Now());

export async function up(knex: Knex): Promise<void> {
	await knex.schema.createTable('txs', (table)=>{
		table.increments('id') //consider migrating to bigIncrements
		table.specificType('txid', 'char(43)').unique().notNullable()
		table.text('content_type').notNullable()
		table.bigInteger('content_size').notNullable() //returns string
		table.boolean('flagged')
		table.boolean('valid_data')
		table.text('data_reason')

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
		table.integer('value').notNullable()
	})
	await knex('states').insert([
		{ pname: 'scanner_position', value: 0},
		{ pname: 'rating_position', value: 0},
	])
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists('txs')
	await knex.schema.dropTableIfExists('states')
}

