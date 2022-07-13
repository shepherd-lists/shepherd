import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.bigInteger('byteStart') //returns string
		table.bigInteger('byteEnd') //returns string

		// table.index('flagged', 'index_flagged', { predicate: knex.whereNot('flagged') })
	})
	await knex.schema.raw('CREATE INDEX txs_flagged ON txs ( flagged ) WHERE flagged=true;')
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('txs', table => {
		table.dropColumn('byteStart')
		table.dropColumn('byteEnd')

		table.dropIndex('flagged', 'txs_flagged')
	}) 
}

