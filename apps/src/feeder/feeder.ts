import { TxRecord, InflightsRecord } from "../common/types"
import dbConnection from "../common/utils/db-connection"
import { logger } from "../common/utils/logger"
import { SQS } from 'aws-sdk'
import { performance } from 'perf_hooks'


const prefix = 'feeder'
const knex = dbConnection() 
const QueueUrl = process.env.AWS_FEEDER_QUEUE as string

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const sqs = new SQS({
	apiVersion: '2012-11-05',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' }),
	maxRetries: 10, //default 3
})

// debug output for sanity
console.log(`process.env.SQS_LOCAL`, process.env.SQS_LOCAL)
console.log(`process.env.AWS_FEEDER_QUEUE`, process.env.AWS_FEEDER_QUEUE)
console.log('sqs.config.endpoint', sqs.config.endpoint)

const getTxRecords =async (limit: number) => {
	const t0 = performance.now()
	const records = await knex<TxRecord>('txs')
		.select(['txs.*'])
		.leftJoin('inflights', 'txs.id', 'inflights.foreign_id')
		.whereNull('inflights.foreign_id')
		.whereNull('valid_data')
		.whereRaw("content_type SIMILAR TO '(image|video)/%'")
		.orderBy('txs.id', 'desc')
		.limit(limit)
	
	const length = records.length
	const duration = performance.now() - t0
	logger(prefix, length, 'records selected. limit', limit, ` - in ${duration.toFixed(2)}ms`)

	return records;
}

export const feeder = async()=> {

	// some constants we might finesse later
	const WORKING_RECORDS = 25000 //aim of min 100k/hr: ~ 15mins of txs
	const ABSOLUTE_TIMEOUT = 1 * 60 * 1000 //1 mins


	while(true){
		const numSqsMsgs = await approximateNumberOfMessages()
		logger(prefix, 'approximateNumberOfMessages', numSqsMsgs)
		if(numSqsMsgs < WORKING_RECORDS ){
			await sendToSqs( await getTxRecords(WORKING_RECORDS) )
		}
		logger(prefix, 'sleeping for 1 minutes...')
		await sleep(ABSOLUTE_TIMEOUT)
	}
}

const approximateNumberOfMessages = async()=> +(await sqs.getQueueAttributes({
	QueueUrl,
	AttributeNames: ['ApproximateNumberOfMessages'],
}).promise()).Attributes!.ApproximateNumberOfMessages


const sendToSqs = async(records: TxRecord[])=>{

	let count = 0
	let promisesBatch = []
	const promisesBatchSize = 100 // 10 - 100 seems to be a sweet spot for performance
	let inflights: InflightsRecord[] = []
	let entries: SQS.SendMessageBatchRequestEntryList = []
	const messageBatchSize = 10 // max 10 messages for sqs.sendMessageBatch
	
	console.log('promise batch size', promisesBatchSize)

	let t0 = performance.now()
	
	for(const rec of records){
		entries.push({
			Id: rec.txid,
			MessageBody: JSON.stringify(rec)
		})
		inflights.push({
			txid: rec.txid,
			foreign_id: rec.id,
		})

		if(entries.length === messageBatchSize){
			promisesBatch.push( 
				processMessageBatch(inflights, entries) 
			)

			entries = []
			inflights = []
		}

		if(promisesBatch.length === promisesBatchSize){
			await Promise.all(promisesBatch)
			promisesBatch = []
		}

		if(++count % 1000 === 0){
			console.log(`${count} messages sent inflight. ${(performance.now()-t0).toFixed(2)}ms`)
			t0 = performance.now()
		}
	}
	// handle the remainers
	if(entries.length > 0){
		promisesBatch.push( 
			processMessageBatch(inflights, entries) 
		)
	}
	if(promisesBatch.length > 0){
		await Promise.all(promisesBatch)
		console.log(`${count} remaining messages sent`)
	}

	console.log('approximateNumberOfMessages', await approximateNumberOfMessages())
}

const processMessageBatch = async(inflights: InflightsRecord[], entries: SQS.SendMessageBatchRequestEntry[])=> {
	// return new Promise<number>(async resolve =>{
		let ifRecs = inflights //careful with these refs
		const res = await sqs.sendMessageBatch({
			QueueUrl,
			Entries: entries,
		}).promise()
		
		const fails = res.Failed.length
		if(fails > 0){
			const total = res.Successful.length + fails
			logger(prefix, `Failed to batch send ${fails}/${total} messages:`)
			for (const f of res.Failed) {
				logger(f.Id, `${f.Code} : ${f.Message}. ${f.SenderFault && 'SenderFault.'}`)
				ifRecs = ifRecs.filter(ifRec => ifRec.txid !== f.Id)
			}
		}
		if(ifRecs.length > 0){
			await knex<TxRecord>('inflights').insert(ifRecs).onConflict().ignore()
		}
	// 	resolve(0)
	// })
}