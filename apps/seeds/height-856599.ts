import { Knex } from "knex";
import { StateRecord, TxRecord } from '../src/types'
import { logger } from '../src/utils/logger'
import fs from 'fs'
import { parse } from 'csv-parse'
import col from 'ansi-colors'
import got from 'got'

export async function seed(knex: Knex): Promise<void> {

	const getPosition = async()=> (await knex<StateRecord>('states').where({pname: 'scanner_position'}))[0].value

	let currentPosition = await getPosition()
	logger('data-seed', 'scanner_position', currentPosition)
	if(currentPosition >= 856599){
		logger('data-seed', 'shepherd data already above 856599. exiting seed.')
		return;
	}
	
	// const parser = fs.createReadStream(`${__dirname}/` + '../../../db-dumps/shepgdb-20220223-txs-TEST.csv').pipe( 

	const parser = got.stream('https://shepherd-dump.s3.eu-west-2.amazonaws.com/shepgdb-20220224-txs.csv').pipe(
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
	logger('data-seed', col.green(`\ndone processing ${count} records :-)`))

	await knex<StateRecord>('states').update({ value: 856599}).where({ pname: 'scanner_position'})
	logger('data-seed', 'updated scanner_position', await getPosition())

};
