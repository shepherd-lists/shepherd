import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', (table)=>{
		table.index('height')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', (table)=>{
		table.dropIndex('height')
	})
}

