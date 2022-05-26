import { SQS } from 'aws-sdk'
import axios from 'axios'
import { FEEDER_Q_VISIBILITY_TIMEOUT, FetchersStatus, HOST_URL, NO_STREAM_TIMEOUT } from '../common/constants'
import { TxScanned } from '../common/types'
import dbConnection from '../common/utils/db-connection'
import { logger } from '../common/utils/logger'
import { s3Delete, s3UploadStream } from './s3Services'
import { IncomingMessage } from 'http'
import { filetypeStream } from './fileTypeStream'
import { dbNoDataFound, dbNoDataFound404 } from '../common/utils/db-update-txs'


const prefix = 'fetchers'
const knex = dbConnection() 
const QueueUrl = process.env.AWS_FEEDER_QUEUE as string
const STREAMS_PER_FETCHER = Number(process.env.STREAMS_PER_FETCHER)

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

	console.log('STREAMS_PER_FETCHER', STREAMS_PER_FETCHER)
	fetcherLoop()

}

export const fetcherLoop = async()=> {

	while(true){ //loop for dev only
		const m = await getMessage()
		if(m){
			const rec: TxScanned = JSON.parse(m.Body!)
			const txid = rec.txid

			logger(fetchers.name, 
				`starting ${m.MessageId}`, 
				`txid ${rec.txid}`,
				`size ${(Number(rec.content_size)/1024).toFixed(1)}kb`,
			)

			let incoming: IncomingMessage
			let uploaded: "OK" | "ABORTED"
			try{
				incoming = await dataStream(m.MessageId!, txid)
				await filetypeStream(incoming, txid, rec.content_type) // file-type only check first bytes, so await ok or error
				uploaded = await s3UploadStream(incoming, rec.content_type, txid)
				
			}catch(e:any){
				const badMime = e.message as FetchersStatus === 'BAD_MIME'
				const status = Number(e.response?.status) || 0
				const code = e.response?.code || e.code || 'no-code'
				
				if(status === 404){
					logger(fetchers.name, `404 returned for ${txid}`)
					await dbNoDataFound404(txid)
				}
				else if(badMime){
					if(process.env.NODE_ENV==='test') logger(fetchers.name, `BAD_MIME returned for ${txid}`) 
					//cleanup is handled in filetypeStream function
				}
				else if(
					status >= 500
					|| ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(code)
				){
					logger(fetchers.name, `network error during ${txid}`, status, code)
					// dont delete the SQS message, let it retry
					continue;
				}
				else{
					logger(fetchers.name, 'Unhandled error', e.message)
					throw e;
				}
			}

			// complete, so delete the SQS message
			await deleteMessage(m)
			console.log(`deleted message: ${m.MessageId} ${rec.txid}`)
			
		}else{
			console.log('got no message. waiting..')
			await sleep(5000)
		}
	}
}


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
		( process.env.NODE_ENV==='test' && console.log('close', msgId, received) )
		if(!incoming.readableEnded){ //i.e. 'end'
			if(received === 0n){
				logger(dataStream.name, 'NO_DATA detected. length', received) 
				incoming.emit('error', new Error('NO_DATA'))
			}else if(contentLength !== received){
				logger(dataStream.name, 'partial detected. length', received) 
				//partial data will be classified too
				incoming.emit('end')
			}
		}
	})
	
	if(process.env.NODE_ENV === 'test'){ 
		incoming.on('end',()=> console.log('end', msgId))
	}
	
	incoming.setTimeout(NO_STREAM_TIMEOUT, ()=>{
		logger(dataStream.name, 'stream no-activity timeout', msgId, txid)
		control.abort() //abort axios
		incoming.destroy() //close called next
	})

	incoming.on('error', async e =>{
		const eMessage = e.message as FetchersStatus
		if(eMessage === 'BAD_MIME'){
			control.abort()
			incoming.destroy()
		}else if(eMessage === 'NO_DATA'){
			// a no-data stream will already have closed
			await dbNoDataFound(txid)
			await s3Delete(txid)
		}
	})

	return incoming;
} 

