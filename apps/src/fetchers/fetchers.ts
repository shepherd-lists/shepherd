import { SQS } from 'aws-sdk'
import axios from 'axios'
import { FEEDER_Q_VISIBILITY_TIMEOUT, FetchersStatus, HOST_URL, NO_STREAM_TIMEOUT, network_EXXX_codes } from '../common/constants'
import { TxScanned } from '../common/types'
import dbConnection from '../common/utils/db-connection'
import { logger } from '../common/utils/logger'
import { s3Delete, s3UploadStream } from './s3Services'
import { IncomingMessage } from 'http'
import { dbNegligibleData, dbNoDataFound, dbNoDataFound404 } from '../common/utils/db-update-txs'


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
	const msgs = Messages! || []
	logger(prefix, `received ${msgs.length} messages`)
	
	return msgs;
}
//exported for test
let _messages: SQS.Message[] = []
let _loading = false
export const getMessage = async()=> {
	
	while(_loading) await sleep(10)
	
	if(_messages.length === 0){
		if(!_loading){
			_loading = true
			_messages = await getMessages()
			_loading = false
		}
	}
	
	return _messages.pop() // if no messages, returns undefined
}

//exported for test
export const deleteMessage = async(msg: SQS.Message)=> {
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
	for (let i = 0; i < STREAMS_PER_FETCHER; i++) {
		fetcherLoop()
	}

}

export const fetcherLoop = async(loop: boolean = true)=> {

	do{ // simple loop for mvp fetcher
		const msg = await getMessage()
		if(msg){
			const rec: TxScanned = JSON.parse(msg.Body!)
			const txid = rec.txid

			logger(fetcherLoop.name, 
				`starting ${msg.MessageId}`, 
				`txid ${rec.txid}`,
				`size ${(Number(rec.content_size)/1024).toFixed(1)} kb`,
			)

			let incoming: IncomingMessage
			try{
				incoming = await dataStream(txid)
				await s3UploadStream(incoming, rec.content_type, txid)
				
			}catch(e:any){
				const status = Number(e.response?.status) || Number(e.statusCode) || 0
				const code = e.response?.code || e.code || 'no-code'
				
				if(status === 404){
					logger(fetcherLoop.name, `404 returned for ${txid}`)
					await dbNoDataFound404(txid)
				}
				else if(
					status >= 500
					|| network_EXXX_codes.includes(code)
				){
					logger(fetcherLoop.name, `network error during ${txid}. continue after SQS timeout`, status, code)
					// dont delete the SQS message, let it retry
					continue;
				}
				else{
					logger(fetcherLoop.name, 'Unhandled error', txid, e.name, e.message)
					throw e;
				}
			}

			// complete, so delete the SQS message
			await deleteMessage(msg)
			logger(fetcherLoop.name, `deleted message: ${msg.MessageId} ${rec.txid}`)
			
		}else{
			// console.log('got no message. waiting 5s ..')
			await sleep(5000)
		}
	}while(loop)
}


export const dataStream = async(txid: string)=> {
	
	let networkError = false;
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
		( process.env.NODE_ENV==='test' && console.log('close', txid, received, 'readableEnded:', incoming.readableEnded) )
		if(!incoming.readableEnded && !networkError){ //i.e. 'end' not called
			if(received === 0n){
				logger(dataStream.name, 'NO_DATA detected. length', received, txid) 
				//inform other consumers
				const NO_DATA: FetchersStatus = 'NO_DATA'
				incoming.emit('error', new Error(NO_DATA)) //signal consumers to abort
				//clean up and mark bad txid
				await dbNoDataFound(txid) 
			}else if(received < 125n){
				logger(dataStream.name, 'NEGLIGIBLE_DATA, PARTIAL detected. length', received, txid) 
				const NEGLIGIBLE_DATA: FetchersStatus = 'NEGLIGIBLE_DATA'
				await dbNegligibleData(txid)
				// await s3Delete(txid) //just in case
				incoming.emit('error', new Error(NEGLIGIBLE_DATA)) 
			}else if(contentLength !== received){
				logger(dataStream.name, 'partial detected. length', received, txid) 
				//partial data can be classified too
				incoming.emit('end') //end the stream so consumers can finish processing.
			}else{
				logger(dataStream.name, 'UNHANDLED. Something unexpected happened before `end` was emitted', txid, received, contentLength)
			}
		}else{ //end was called
			if(received < 125n){
				logger(dataStream.name, 'negligible data detected', received, txid)
				await dbNegligibleData(txid)
				await s3Delete(txid)
			}
		}
	})
	
	if(process.env.NODE_ENV === 'test'){ 
		incoming.on('end', ()=> console.log('end', txid))
	}

	incoming.on('error', e => {
		const code = (e as any).code
		if(code && network_EXXX_codes.includes(code)){
			logger(dataStream.name, 'net error event', e.name, e.message, code, txid)
			networkError = true
		}
	})
	
	incoming.setTimeout(NO_STREAM_TIMEOUT, ()=>{
		logger(dataStream.name, 'stream no-activity timeout. aborting', txid)
		control.abort() //abort axios
		incoming.destroy() //close called next
	})


	return incoming;
} 

