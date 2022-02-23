import { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
	await knex.schema.table('txs', table=>{
		//remove nsfw_* columns
		table.dropColumns(
			'nsfw_porn',
			'nsfw_sexy',
			'nsfw_hentai',
			'nsfw_neutral',
			'nsfw_drawings',
		)
		//add height column
		table.integer('height')

	})
	//create new flagged table?
}


export async function down(knex: Knex): Promise<void> {
	await knex.schema.table('txs', table=>{
		table.float('nsfw_porn')
		table.float('nsfw_sexy')
		table.float('nsfw_hentai')
		table.float('nsfw_neutral')
		table.float('nsfw_drawings')

		table.dropColumn('height')
	})
}

