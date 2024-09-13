import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists('outbox')
}


export async function down(knex: Knex): Promise<void> {
		await knex.schema.createTable('outbox', (table)=>{
		table.specificType('txid', 'char(43)').primary()
		table.integer('height').notNullable()
	})
}

