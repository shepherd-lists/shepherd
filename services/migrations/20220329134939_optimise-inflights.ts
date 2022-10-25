import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('inflights', (table)=>{
		table.dropUnique(['txid'], undefined)
		table.unique(['foreign_id'])
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('inflights', (table)=>{
		table.dropUnique(['foreign_id'], undefined)
		table.unique(['txid'])
	})
}

