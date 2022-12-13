import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.specificType('parents', 'char(43) ARRAY')
	})

}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.dropColumn('parents')
	}) 
}

