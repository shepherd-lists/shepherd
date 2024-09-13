import knex, { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	//fast table for temporary data
	await knex.schema.createTable('inflights', (table)=>{
		table.increments('id') 
		table.integer('foreign_id')
		table.foreign('foreign_id').references('txs.id')
		table.specificType('txid', 'char(43)').unique().notNullable()
		table.timestamp('created_at', {useTz: true}).defaultTo(knex.fn.now())
	})
	//not sure how to do `create unlogged table` with knex
	await knex.schema.raw('ALTER TABLE inflights SET UNLOGGED')
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists('inflights')
}

