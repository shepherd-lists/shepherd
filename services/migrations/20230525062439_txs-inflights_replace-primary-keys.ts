import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('inflights', (table)=>{
		table.dropForeign(['foreign_id'])
	})
	await knex.schema.alterTable('txs', (table)=>{
		table.dropPrimary()
		table.dropUnique(['txid'])
		table.primary(['txid'])
		table.dropColumn('id')
	})
	await knex.schema.alterTable('inflights', (table)=>{
		table.foreign('txid').references('txs.txid')
		table.dropPrimary()
		table.primary(['txid'])
		table.dropColumn('id')
		table.dropColumn('foreign_id')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('inflights', (table)=>{
		table.dropForeign(['txid'])
		table.dropPrimary()
	})
	await knex.schema.alterTable('txs', (table)=>{
		table.dropPrimary()
		table.unique(['txid'])
		table.increments('id')
		table.primary(['id'])
	})
	await knex.schema.alterTable('inflights', (table)=>{
		table.increments('id').primary()
		table.integer('foreign_id')
		table.foreign('foreign_id').references('txs.id')
	})
}

