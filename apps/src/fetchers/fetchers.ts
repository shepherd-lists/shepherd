import { S3, SQS } from 'aws-sdk'
import axios from 'axios'
import { FEEDER_Q_VISIBILITY_TIMEOUT, HOST_URL, NO_STREAM_TIMEOUT } from '../common/constants'
import { TxRecord, TxScanned } from '../common/types'
import dbConnection from '../common/utils/db-connection'
import { logger } from '../common/utils/logger'
import { s3Stream } from './s3Stream'
import { IncomingMessage } from 'http'
import { pipeline } from 'stream/promises'


const prefix = 'fetchers'
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
console.log('process.env.STREAMS_PER_FETCHER', process.env.STREAMS_PER_FETCHER)

const getMessages = async(): Promise<SQS.Message[]> => {
	const { Messages } = await sqs.receiveMessage({
		QueueUrl,
		MaxNumberOfMessages: 10,
		MessageAttributeNames: ['All'],
		VisibilityTimeout: FEEDER_Q_VISIBILITY_TIMEOUT,
		WaitTimeSeconds: 0,
	}).promise()
	const msgs = Messages!
	logger(prefix, `received ${msgs?.length} messages`)
	
	return msgs || [];
}
let messages: SQS.Message[] = []
const getMessage = async()=> {
	if(messages.length === 0){
		messages = await getMessages()
	}
	return messages.pop() // if no messages, returns undefined
}

const deleteMessages = async(Messages: SQS.Message[])=> {
	const deleted = await Promise.all(Messages.map(msg=> deleteMessage(msg) ))
	logger(prefix, `deleted ${deleted.length} of ${Messages.length} messages.`)
	
	return deleted.length;
}

const deleteMessage = async(msg: SQS.Message)=> {
	try{
		await sqs.deleteMessage({
			ReceiptHandle: msg.ReceiptHandle!,
			QueueUrl,
		}).promise()
	}catch(e){
		if(e instanceof Error){
			if(e.name === 'UnknownEndpoint'){
				console.log('sqs UnknownEndpoint error.', e.name, ':', e.message)
				throw e;
			}
			if(e.name === 'ReceiptHandleIsInvalid'){
				if(process.env.NODE_ENV !== 'test'){
					console.log('sqs ReceiptHandleIsInvalid error. Message deleted already?', e.name, ':', e.message)
				}
				return;
			}

			console.log(prefix, `sqs delete error. ${e.name} : ${e.message}`)
		}
		throw e;
	}
}
  
export const fetchers = async()=> {


	process.env.STREAMS_PER_FETCHER
	const numStreams = 50

	while(true){ //loop for dev only
		const m = await getMessage()
		if(m){
			logger(fetchers.name, 'starting', m.MessageId)
			
			const rec: TxScanned = JSON.parse(m.Body!)

			let incoming: IncomingMessage
			// if(ret === 'NO_DATA'){
				// 	// await dbNoDataFound(rec.txid)
				// }
			try{
				incoming = await dataStream(m.MessageId!, rec.txid)
				const uploaded = await s3Stream(incoming, rec.content_type, rec.txid)
				
			}catch(e){
				console.log('FETCHERS Unhandled', e)
				throw e;
			}

			await deleteMessage(m)
			console.log(`deleted message: ${m.MessageId} ${'rec.txid'}`)
		}else{
			console.log('got no message. waiting..')
			await sleep(5000)
		}
	}

	
}

// export const dataStreamErrors = async(msgId: string, txid: string)=> {
// 	try{
// 		const incoming = await dataStream(msgId, txid)
// 		const eHandler = (e:any) => {
// 			if(e.message==='NO_DATA'){
// 				throw new Error('NO_DATA error thrown')
// 			}
// 		}
// 		incoming.on('error', eHandler)
	
// 		return incoming
// 	}catch(e:any){
// 		const status = Number(e.response?.status) || 0
// 		const code = e.response?.code || e.code || 'no-code'
// 		if(status === 404){
// 			console.log('caught 404')
// 			return '404';
// 		}else{
// 			console.log('caught', e)
// 			return e.message;
// 		}

// 	}
// }

export const dataStream = async(msgId: string, txid: string)=> {
	
	const control = new AbortController()
	const { data, headers} = await axios.get(`${HOST_URL}/${txid}`, { 
		responseType: 'stream',
		signal: control.signal,
	})
	const incoming: IncomingMessage = data
	const contentLength = BigInt(headers['content-length'])

	let received = 0n
	incoming.on('data', (chunk: Uint8Array) => {
		received += BigInt(chunk.length)
		if(process.env.NODE_ENV==='test') process.stdout.write('.')
	})

	incoming.on('close', async()=> {
		console.log('close', msgId, received)
		if(!complete){
			if(received === 0n){
				console.log('NO_DATA detected. length', received) 
				incoming.emit('error', new Error('NO_DATA'))
			}else if(contentLength !== received){
				console.log('partial detected. length', received) 
				//partial data will be classified too
				incoming.emit('end')
			}
		}
	})
	
	let complete = false
	incoming.on('end',()=>{
		console.log('end', msgId)
		complete = true
	})
	
	incoming.setTimeout(NO_STREAM_TIMEOUT, ()=>{
		console.log(prefix, 'activity timeout occurred on', msgId, txid)
		control.abort() //abort axios
		incoming.destroy() //close called next
	})

	return incoming;
} 

export const filetypeStream = async()=> {
	
}