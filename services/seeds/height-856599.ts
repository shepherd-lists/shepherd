import { Knex } from "knex";
import { StateRecord, TxRecord } from '../src/common/shepherd-plugin-interfaces/types'
import { logger } from '../src/common/shepherd-plugin-interfaces/logger'
import { parse } from 'csv-parse'
import col from 'ansi-colors'
import got from 'got' // needs non-esm 11.8.3

export async function seed(knex: Knex): Promise<void> {

	const getPosition = async()=> (await knex<StateRecord>('states').where({pname: 'scanner_position'}))[0].value

	let currentPosition = await getPosition()
	logger('data-seed', 'scanner_position', currentPosition)

	/**
	 * *** THIS SEED & SCRIPT ARE OUR OF DATE NOW ***
	 */
	
	if(currentPosition >= /* 856599 */ 0){ 
		logger('data-seed', 'shepherd data already above 856599. exiting seed.')
		return;
	}
	
	// const parser = fs.createReadStream(`${__dirname}/` + '../../../db-dumps/shepgdb-20220223-txs-TEST.csv').pipe( 

	const parser = got.stream('https://shepherd-seed.s3.eu-central-1.amazonaws.com/shepgdb-20220224-txs.csv').pipe(
		parse({
			columns: (header: any[]) => { 
				header[0] = false  //remove id from records
				return header;
			}
		}) 
	)

	// incoming csv columns guide {
	// 	false // id: string
	// 	txid: string
	// 	content_type: string
	// 	content_size: string
	// 	flagged: boolean!
	// 	valid_data: boolean!
	// 	data_reason: string
	// 	last_update_date: Date
	//	height: integer!
	// }

	let count = 0
	let batch = []
	const batchsize = 100

	for await (const record of parser) {
		// turn empty strings into boolean/integer equivalents 
		if(record.flagged === '') record.flagged = null
		if(record.valid_data === '') record.valid_data = null
		if(record.height === '') record.height = null

		batch.push(record)

		if(++count % batchsize === 0){
			// insert a batch of records
			await knex<TxRecord>('txs').insert(batch).onConflict('txid').ignore()
			batch = []
		}

		if(count % 10000===0) logger('data-seed', 'records done', count)

	}
	if(batch.length > 0){
		await knex<TxRecord>('txs').insert(batch).onConflict('txid').ignore()
	}


	logger('data-seed', col.green(`\ndone processing ${count} records :-)`))

	await knex<StateRecord>('states').update({ value: 856599}).where({ pname: 'scanner_position'})
	logger('data-seed', 'updated scanner_position', await getPosition())

};
