import { TxRecord, InflightsRecord } from "../types"
import dbConnection from "../utils/db-connection"
import { logger } from "../utils/logger"
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
		.select([
			'txs.id',
			'txs.txid',
			'txs.content_type',
			'txs.content_size',
			'txs.flagged',
			'txs.valid_data',
			'txs.data_reason',
			'txs.last_update_date',
			'txs.height',
		])
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
	const ABSOLUTE_TIMEOUT = 15 * 60 * 1000 //15 mins


	while(true){
		const numSqsMsgs = await approximateNumberOfMessages()
		logger(prefix, 'approximateNumberOfMessages', numSqsMsgs)
		if(numSqsMsgs < WORKING_RECORDS ){
			await sendToSqs( await getTxRecords(WORKING_RECORDS) )
		}
		logger(prefix, 'sleeping for 15 minutes...')
		await sleep(ABSOLUTE_TIMEOUT)
	}
}

const approximateNumberOfMessages = async()=> +(await sqs.getQueueAttributes({
	QueueUrl,
	AttributeNames: ['ApproximateNumberOfMessages'],
}).promise()).Attributes!.ApproximateNumberOfMessages


const sendToSqs = async(records: TxRecord[])=>{

	let count = 0
	let promises = []
	let inflights: InflightsRecord[] = []
	const promisesBatch = 100 // 10 - 100 seems to be a sweet spot for performance on elasticmq
	let entries: SQS.SendMessageBatchRequestEntryList = []
	const messageBatchSize = 10 // max 10 messages for sqs.sendMessageBatch
	
	console.log('promise batch size', promisesBatch)

	let t0 = performance.now()
	
	for(const rec of records){
		entries.push({
			Id: rec.txid,
			MessageBody:  JSON.stringify(rec)
		})
		inflights.push({
			txid: rec.txid,
			foreign_id: rec.id,
		})

		if(entries.length === messageBatchSize){
			promises.push(
				sqs.sendMessageBatch({
					QueueUrl,
					Entries: entries,
				})
				.promise()
				.then(res=>{
					const fails = res.Failed.length
					if(fails > 0){
						const total = res.Successful.length + fails
						console.log(`Failed to batch send ${fails}/${total} messages:`)
						for(const f of res.Failed){
							console.log(f.Id)
							// now remove from inflights ...
						}
					}
				})
			)
			await knex<TxRecord>('inflights ').insert(inflights).onConflict().ignore()
			entries = []
			inflights = []
		}
		

		if(promises.length === promisesBatch){
			await Promise.all(promises)
			promises = []
		}

		if(++count % 1000 === 0){
			console.log(`${count} messages sent inflight. ${(performance.now()-t0).toFixed(2)}ms`)
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
		await knex<TxRecord>('inflights ').insert(inflights).onConflict().ignore()
	}
	if(promises.length > 0){
		await Promise.all(promises)
		console.log(`${count} remaining messages sent`)
	}

	console.log('approximateNumberOfMessages', await approximateNumberOfMessages())
}