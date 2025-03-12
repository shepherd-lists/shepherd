import { TxRecord, InflightsRecord } from '../common/shepherd-plugin-interfaces/types'
import dbConnection from '../common/utils/db-connection'
import { logger } from '../common/utils/logger'
import { SQS } from 'aws-sdk'
import { performance } from 'perf_hooks'
import { slackLogger } from '../common/utils/slackLogger'
import { legacyRecordOwnerFix } from './legacyFix-RecordOwner'


const prefix = 'feeder'
const knex = dbConnection()
const QueueUrl = process.env.AWS_FEEDER_QUEUE as string
const InputQueueUrl = process.env.AWS_SQS_INPUT_QUEUE as string

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const sqs = new SQS({
	apiVersion: '2012-11-05',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' }),
	maxRetries: 10, //default 3
})

// debug output for sanity
console.log('process.env.SQS_LOCAL', process.env.SQS_LOCAL)
console.log('process.env.AWS_FEEDER_QUEUE', process.env.AWS_FEEDER_QUEUE)
console.log('sqs.config.endpoint', sqs.config.endpoint)

const getTxRecords =async (limit: number) => {
	while(true){
		try{
			const t0 = performance.now()
			const records = await knex<TxRecord>('inbox')
				.select(['inbox.*'])
				.leftJoin('inflights', 'inbox.txid', 'inflights.txid')
				.whereNull('inflights.txid')
				.whereNull('valid_data')
				.whereRaw('content_type SIMILAR TO \'(image|video|audio|application/octet)%\'')
				.orderBy('inbox.height', 'asc')
				.limit(limit)

			const length = records.length
			const duration = performance.now() - t0
			logger(prefix, length, 'records selected. limit', limit, ` - in ${duration.toFixed(2)}ms`)

			/** quick n dirty fix for older records without owners */
			// return records
			return await Promise.all(records.map(async rec => {
				if(!rec.owner){
					rec.owner = await legacyRecordOwnerFix(rec.txid)
				}
				rec.owner = (rec.owner as string).padEnd(43, ' ') //pad non-arweave addresses to 43 chars
				return rec
			}))

		}catch(e){
			if(e instanceof Error && e.name === 'KnexTimeoutError'){
				logger(getTxRecords.name, e.name, ':', e.message, 'retrying in 5s...')
				slackLogger(getTxRecords.name, e.name, ':', e.message, 'retrying in 5s...')
				await sleep(5000)
				continue
			}
			console.log(`error in ${getTxRecords.name}`)
			throw e
		}
	}
}

const getInflightsSize = async()=> {
	while(true){
		try{
			return +(await knex.raw('SELECT reltuples::bigint AS estimate FROM pg_class where relname = \'inflights\'')).rows[0].estimate
		}catch(err:unknown){
			const e = err as Error
			logger(getInflightsSize.name, `some error getting table size. ${e.name}:${e.message}. waiting 30s...`)
			slackLogger(getInflightsSize.name, `some error getting table size. ${e.name}:${e.message}. waiting 30s...`)
			await sleep(30000)
		}
	}
}

export const feeder = async()=> {

	// some constants we might finesse later
	const WORKING_RECORDS = 25_000 //aim of min 100k/hr: ~ 15mins of txs
	const LIMIT_RECORDS = 100
	const ABSOLUTE_TIMEOUT = 1 * 60 * 1000 //1 mins
	const INFLIGHTS_MAX = 100_000 //deletions get really slow when inflights table in the millions

	while(true){
		const numSqsMsgs = await approximateNumberOfMessages(QueueUrl)
		logger(prefix, 'approximateNumberOfMessages', numSqsMsgs)

		const numInflights = await getInflightsSize()
		logger(prefix, 'approx. inflights size', numInflights)

		/**
		 *  FUTURE IMPROVEMENT, CHECK THE TOTAL SIZE OF S3 INPUT BUCKET
		 */

		if(numSqsMsgs < WORKING_RECORDS && numInflights < INFLIGHTS_MAX ){
			console.log('DEBUG', `sql select limit ${LIMIT_RECORDS}`)
			const records = await getTxRecords(LIMIT_RECORDS)

			if(records.length !== 0){
				await sendToSqs( records )
				continue
			}
		}

		/** give a warning if inflights is full but queues are empty */
		if(numInflights > INFLIGHTS_MAX){
			const numInputQ = await approximateNumberOfMessages(InputQueueUrl)
			if(numInputQ+numSqsMsgs === 0){
				await slackLogger(`💀❌ inflights: ${numInflights}, but nothing in FEEDER or INPUT queues 💀❌`)
			}
		}

		logger('sleeping for 1 minutes...', `feeders-sqs:${numSqsMsgs}/${WORKING_RECORDS}, inflights:${numInflights}/${INFLIGHTS_MAX}`)
		await sleep(ABSOLUTE_TIMEOUT)
	}
}

const approximateNumberOfMessages = async(QueueUrl: string)=> +(await sqs.getQueueAttributes({
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

	console.log('approximateNumberOfMessages', await approximateNumberOfMessages(QueueUrl))
}

const processMessageBatch = async(inflights: InflightsRecord[], entries: SQS.SendMessageBatchRequestEntry[])=> {
	let _inflights = inflights //careful with these refs
	let _entries = entries

	/** put these all inflight immediately to prevent double sends */

	_inflights = await knex<InflightsRecord>('inflights').insert(_inflights).onConflict().ignore().returning('*')
	const inflightIds = _inflights.map(ifRec => ifRec.txid)

	/** filter out any not inserted and send */

	_entries = _entries.filter(item => inflightIds.includes(item.Id))

	logger(prefix, `sending ${_entries.length} messages to sqs`, JSON.stringify(_entries.map(e => e.Id)))

	const res = await sqs.sendMessageBatch({
		QueueUrl,
		Entries: _entries,
	}).promise()

	/** remove failed sendMessages from inflights */

	const failCount = res.Failed.length
	if(failCount > 0){

		/** informational */
		const total = res.Successful.length + failCount
		logger(prefix, `Failed to batch send ${failCount}/${total} messages:`)
		for(const f of res.Failed){
			logger(f.Id, `${f.Code} : ${f.Message}. ${f.SenderFault && 'SenderFault.'}`)
		}

		const failIds = res.Failed.map(f => f.Id)
		await knex<InflightsRecord>('inflights').delete().whereIn('txid', failIds)
	}
}