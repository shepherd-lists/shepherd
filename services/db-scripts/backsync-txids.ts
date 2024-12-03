// basic argument checking
if(process.argv.length > 2){
	const args = process.argv.slice(2)
	console.log('Received arguments:', args)
}else{
	console.log('Usage: DB_HOST=localhost npx tsx backsync.ts txids.txt')
	process.exit(1)
}
if(!process.env.DB_HOST) throw new Error('DB_HOST env var not set')

import { readFileSync } from 'fs'
import { TxRecord, TxScanned } from '../src/common/shepherd-plugin-interfaces/types'
import dbConnection from '../src/common/utils/db-connection'

const knex = dbConnection()

const main = async () => {


	/** read in txids.txt */
	const txids = readFileSync(process.argv[2], 'utf8').split('\n')
	txids.pop() //last empty
	console.debug(txids.length)

	const txsRecords = await knex<TxRecord>('txs').whereIn('txid', txids)
	console.debug(txsRecords.length)

	const inserts = txsRecords.map(({txid, content_size, content_type, height, parent, parents, owner }):TxScanned => ({txid, content_size, content_type, height, parent, parents, owner }))
	console.debug(inserts.length)

	let count = 0
	let batch = inserts.splice(0, Math.min(100, inserts.length))
	while(batch.length > 0){
		const res = await knex('inbox').insert(batch).returning('txid')
		count +=  res.length
		console.debug(`inserted ${res.length}, tot: ${count}`)

		// get next batch
		batch = inserts.splice(0, Math.min(100, inserts.length))
	}

	console.log('total inserted', count)
	await knex.destroy()

}
main()
