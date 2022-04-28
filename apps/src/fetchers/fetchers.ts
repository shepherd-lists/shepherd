import { S3, SQS } from 'aws-sdk'
import axios from 'axios'
import { FEEDER_Q_VISIBILITY_TIMEOUT, HOST_URL, NO_STREAM_TIMEOUT } from '../constants'
import { TxRecord, TxScanned } from '../types'
import dbConnection from '../utils/db-connection'
import { logger } from '../utils/logger'
// import StreamPlugin from './shepherd-plugin-s3stream/src'
import { IncomingMessage } from 'http'

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

const deleteMessage = async(msg: SQS.Message)=> sqs.deleteMessage({
	ReceiptHandle: msg.ReceiptHandle!,
	QueueUrl,
}).promise()
  
export const fetchers = async()=> {

	/**
	 * - the plan.
	 * create streams from txid sources.
	 * need new streams plugin
	 * check streams for no response, timeout retrieving bytes, 404, etc. consider switching to `got`
	 * check mimes, but no DB updates!
	 * pipe until done, start the next txid
	 */

	// while(true){ !!! no big loop !!! stream providers should be autonomous
		/* get txids */
		/* start streams */
		/* perform stream processing in case of cancelling stream */
	// }

	const numStreams = 50

	while(true){ //loop for dev only
		const m = await getMessage()
		if(m){
			await streamer(m)
		}else{
			console.log('got no message. waiting..')
			await sleep(5000)
		}
	}

	
}

export const streamer = async(m: SQS.Message)=> {
	
	logger('streamer', 'starting', m.MessageId)

	const rec: TxScanned = JSON.parse(m.Body!)

	
	const srcToken = axios.CancelToken.source()
	const { data, headers} = await axios.get(`${HOST_URL}/${rec.txid}`, { 
		responseType: 'stream',
		cancelToken: srcToken.token,
	})
	const read: IncomingMessage = data
	const contentLength = BigInt(headers['content-length'])

	let received = 0n
	read.on('data', (chunk: Uint8Array) => {
		received += BigInt(chunk.length)
		if(process.env.NODE_ENV==='test') process.stdout.write('.')
	})

	read.on('close',()=> {
		console.log('close', m.MessageId, received)
		if(!complete){
			if(received === 0n){
				read.emit('error', new Error('NO_DATA'))
			}else if(contentLength !== received){
				console.log('partial detected. length', received) //read.emit('error', new Error('PARTIAL_ERROR'))
				read.emit('end')
			}
		}
	})

	read.on('abort',()=> console.log('abort'))

	let complete = false
	read.on('end',()=>{
		console.log('end', m.MessageId)
		complete = true
	})

	read.on('error',e=> { 
		console.log('error', e.message, m.MessageId); 
		if(e.message==='NO_DATA') uploader.abort() 
	})

	read.setTimeout(NO_STREAM_TIMEOUT, ()=>{
		console.log(prefix, 'activity timeout occurred on', m.MessageId, rec.txid)
		// read.off('data', test=>console.log('read.off(data)',test))
		srcToken.cancel() //cancel axios
		if(received === 0n){
			read.emit('error', new Error('NO_DATA'))
		}else{
			read.destroy()
		}
	})

	
	console.assert(process.env.AWS_INPUT_BUCKET, 'process.env.AWS_INPUT_BUCKET is undefined')
	const s3 = new S3({
		apiVersion: '2006-03-01',
		endpoint: process.env.AWS_INPUT_BUCKET,
		accessKeyId: 'minioroot',
		secretAccessKey: 'minioroot',
		s3ForcePathStyle: true, // *** needed with minio ***
	})

	let uploader: S3.ManagedUpload
	try{
		uploader = s3.upload({
			Bucket: 'shepherd-input-mod-local',
			Key: rec.txid,
			ContentType: rec.content_type,
			Body: read,
		})
		const data = await uploader.promise()
		console.log('uploaded to', data.Location)

		await deleteMessage(m)
		console.log(`deleted message: ${m.MessageId} ${rec.txid}`)
		return true;
	}catch(e){
		if(e instanceof Error){
			if(e.name === 'RequestAbortedError'){
				console.log('s3 RequestAbortedError.', m.MessageId)
				return 'NO_DATA';
			}
			if(e.name === 'UnknownEndpoint'){
				console.log('sqs UnknownEndpoint error.', e.name, ':', e.message)
				throw e;
			}
			if(e.name === 'ReceiptHandleIsInvalid'){
				console.log('sqs ReceiptHandleIsInvalid error. Message deleted already?', e.name, ':', e.message)
				return true;
			}

			console.log(`s3upload error. ${e.name} : ${e.message}`)
			return;
		}
		throw e; 
	}//end trycatch uploader
} 