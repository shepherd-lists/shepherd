import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	/** no references. keeping this light. only read on service startup */
	await knex.schema.createTable('outbox', (table)=>{
		table.specificType('txid', 'char(43)').primary()
		table.integer('height').notNullable()
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.dropTableIfExists('outbox')
}

