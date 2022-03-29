import { TxRecord } from "../types"
import dbConnection from "../utils/db-connection"
import { logger } from "../utils/logger"
import { SQS } from 'aws-sdk'
import { performance } from 'perf_hooks'


const prefix = 'feeder'
const knex = dbConnection() 
const QueueUrl = process.env.AWS_FEEDER_QUEUE as string

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const getTxRecords =async (limit: number) => {
	const records = await knex<TxRecord>('txs')
		.whereNull('valid_data')
		.whereRaw("content_type SIMILAR TO '(image|video)/%'")
		.whereNotIn('id', knex.select('foreign_id').from('inflights'))
		.orderBy('id', 'desc')
		.limit(limit)

	const length = records.length
	logger(prefix, length, 'records selected. limit', limit)

	return records;
}

console.log(`process.env.SQS_LOCAL`, process.env.SQS_LOCAL)
console.log(`process.env.AWS_FEEDER_QUEUE`, process.env.AWS_FEEDER_QUEUE)

const sqs = new SQS({
	apiVersion: '2012-11-05',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' }),
	maxRetries: 10, //default 3
})
console.log('sqs.config.endpoint', sqs.config.endpoint)

export const feeder = async()=> {

	// some constants we might finesse later
	const WORKING_RECORDS = 25000 //aim of min 100k/hr: ~ 15mins of txs
	const ABSOLUTE_TIMEOUT = 15 * 60 * 1000 //15 mins


	while(true){
		if(+await approximateNumberOfMessages() < WORKING_RECORDS ){
			await sendToSqs( await getTxRecords(WORKING_RECORDS) )
		}
		await sleep(ABSOLUTE_TIMEOUT)

	}
}

const approximateNumberOfMessages = async()=> (await sqs.getQueueAttributes({
	QueueUrl,
	AttributeNames: ['ApproximateNumberOfMessages'],
}).promise()).Attributes!.ApproximateNumberOfMessages


const sendToSqs = async(records: TxRecord[])=>{

	let count = 0
	let promises = []
	const promisesBatch = 100 // 10 - 100 seems to be a sweet spot for performance on elasticmq
	let entries: SQS.SendMessageBatchRequestEntryList = []
	const messageBatchSize = 10 // max 10 messages for sqs.sendMessageBatch
	
	console.log('promise batch size', promisesBatch)

	let t0 = performance.now()
	
	for(const rec of records){

		entries.push({
			Id: rec.txid,
			MessageDeduplicationId: rec.txid,
			MessageGroupId: 'group0',
			MessageBody:  JSON.stringify(rec)
		})

		if(entries.length === messageBatchSize){
			promises.push(
				sqs.sendMessageBatch({
					QueueUrl,
					Entries: entries,
				}).promise()
			)
			entries = []
		}
		

		if(promises.length === promisesBatch){
			await Promise.all(promises)
			promises = []
		}

		if(++count % 1000 === 0){
			console.log(`${count} messages sent in ${(performance.now()-t0).toFixed(2)}ms`)
			t0 = performance.now()
		}
	}
	// handle the remainers
	if(entries.length > 0){
		promises.push(
			sqs.sendMessageBatch({
				QueueUrl,
				Entries: entries,
			}).promise()
		)
	}
	if(promises.length > 0){
		await Promise.all(promises)
		console.log(`${count} remaining messages sent`)
	}

	console.log('approximateNumberOfMessages', await approximateNumberOfMessages())
}