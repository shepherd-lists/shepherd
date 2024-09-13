import { Knex } from "knex";
import { HistoryRecord } from "../src/common/shepherd-plugin-interfaces/types";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('history', (table)=>{
		table.renameColumn('scanner_position', 'indexer_pass1')
	})
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('history', (table)=>{
		table.renameColumn('indexer_pass1', 'scanner_position')
	})
}

