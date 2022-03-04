/**
 * this needs pgdb port 5432 opened in docker-compose.override.yml
 * run with: npx ts-node db-scripts/insert-heights.ts 
 */
import axios from "axios";
import { TxRecord } from "../src/types";
import dbConnection from "../src/utils/db-connection";
import col from 'ansi-colors'
import { performance } from 'perf_hooks'

const knex = dbConnection()
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const main = async()=> {

	/* create txs_temp table */

	await knex.schema.createTable('txs_temp', (table)=>{
		table.increments('id') 
		table.specificType('txid', 'char(43)').unique().notNullable()
		table.text('content_type').notNullable()
		table.bigInteger('content_size').notNullable() //returns string
		table.boolean('flagged')
		table.boolean('valid_data')
		table.text('data_reason')

		table.integer('height') // <= new!

		table.timestamp('last_update_date', { useTz: true }).defaultTo(knex.fn.now())
	})
	await knex.schema.raw('ALTER TABLE txs_temp ADD CONSTRAINT cc_txid CHECK ((char_length(txid) = 43))')

	/* stream values from txs->txs_temp + add height values retrieved from gql */

	const stream = knex<TxRecord>('txs').select(
		'txid', 
		'content_type', 
		'content_size',
		'flagged',
		'valid_data',
		'data_reason',
		'height',
		'last_update_date'
	).stream()

	let records = []
	let txids = []
	let count = 0
	for await (const rec of stream){
		records.push(rec)
		txids.push(rec.txid)

		let heights = []
		if(++count % 100 === 0){
			const t0 = performance.now()
			
			let done = false
			while(!done){
				try{
					heights = await gqlHeights(txids)
					done = true
				}catch(e){
					console.log(col.redBright(`Error! Waiting 2 mins..${e}`))
					await sleep(120000)
				}
			} 

			for (let i = 0; i < records.length; i++) {
				records[i].height = heights[i]
			}

			await knex<TxRecord>('txs_temp').insert(records).onConflict('txid').ignore()

			records = []
			txids = []
			if(count % 10000===0) console.log('count', count)

			const tProcess = performance.now() - t0
			let timeout = 100 - tProcess
			if(timeout > 0){
				process.stdout.write('_') //denotes normal processing time
				// console.log(`process time ${tProcess.toFixed(0)} ms. pausing for ${timeout.toFixed(0)}ms`)
				// await sleep(timeout) //slow down, we're getting rate-limited 
			}else{
				process.stdout.write('-') //denotes that processing took longer than normal
			}
		}

	}
	if(records.length > 0){
		console.log(`updating final ${records.length} records`)
		let heights = []

		let done = false
			while(!done){
				try{
					heights = await gqlHeights(txids)
					done = true
				}catch(e){
					console.log(col.redBright(`Error! Waiting 2 mins..${e}`))
					await sleep(120000)
				}
			} 

		for (let i = 0; i < records.length; i++) {
			records[i].height = heights[i]
		}
		await knex<TxRecord>('txs_temp').insert(records).onConflict('txid').ignore()
	}

	console.log(col.green(`\ndone processing ${count} records :-)`))

	/* drop txs */
	/* rename temp->txs */
	/* drop extra txs_temp constraint */

	////safer to do these steps manually after inspecting txs_temp
	////run whatever tests here on data: select count(id) from txs_temp where ... etc
	//drop table txs;
	//alter table txs_temp rename to txs;
	//alter table txs rename constraint txs_temp_txid_unique to txs_txid_unique;
	//alter index txs_temp_pkey rename to txs_pkey;

	knex.destroy()
}
main();

const gqlHeights = async(txids: string[])=> {
	/* querying by hand */

	const query = `query($cursor: String, $txids: [ID!]) {
		transactions(
			ids: $txids
			after: $cursor
			first: 100
			block: {min: 1}
		) {
			pageInfo {
				hasNextPage
			}
			edges {
				cursor
				node{
					block { height }
				}
			}
		}
	}`
	const variables = {
		cursor: '',  //we dont use this, but anyhow
		txids,
	}

	const { data } = await axios.post(
		'https://arweave.net/graphql', 
		JSON.stringify({ query, variables }), 
		{ headers: {'content-type': 'application/json'} },
	)
	
	const edges = data.data.transactions.edges
	const heights = []
	for(const edge of edges){
		heights.push(edge.node.block.height)
	}
	if(heights.length !== edges.length){
		throw new Error('ERROR, NUM HEIGHTS !== NUM TXIDS')
	} 

	return heights;
}