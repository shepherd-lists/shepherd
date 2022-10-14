import { SQS, S3, AWSError } from 'aws-sdk'
import { S3Event } from 'aws-lambda'
import { logger } from './utils/logger'
import memoize from 'micro-memoize'
import { VidDownloads } from './rating/video/VidDownloads'
import { addToDownloads } from './rating/video/downloader'
import { processVids } from './rating/video/process-files'
import { checkImageTxid } from './rating/filter-host'

const prefix = 'nsfw-main'

const vidDownloads = VidDownloads.getInstance()

//debug output for sanity
console.log(`process.env.AWS_SQS_INPUT_QUEUE`, process.env.AWS_SQS_INPUT_QUEUE)
const QueueUrl = process.env.AWS_SQS_INPUT_QUEUE as string
console.log(`process.env.AWS_INPUT_BUCKET`, process.env.AWS_INPUT_BUCKET)
const Bucket = process.env.AWS_INPUT_BUCKET!
console.log(`process.env.NUM_FILES`, process.env.NUM_FILES)
const NUM_FILES = +process.env.NUM_FILES!
console.log(`process.env.TOTAL_FILESIZE_GB`, process.env.TOTAL_FILESIZE_GB)
const TOTAL_FILESIZE = +process.env.TOTAL_FILESIZE_GB! * 1024 * 1024 * 1024

//keep track and set limits based on env inputs
let _currentTotalSize = 0
let _currentNumFiles = 0

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const sqs = new SQS({
	apiVersion: '2012-11-05',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' }),
	maxRetries: 10, //default 3
})

const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.SQS_LOCAL==='yes' && { 
		endpoint: process.env.S3_LOCAL_ENDPOINT!, 
		region: 'dummy-value',
		s3ForcePathStyle: true, // *** needed with minio ***
	}),
	maxRetries: 10,
})

const getMessages = async(): Promise<SQS.Message[]> => {
	const { Messages } = await sqs.receiveMessage({
		QueueUrl,
		MaxNumberOfMessages: 10,
		MessageAttributeNames: ['All'],
		VisibilityTimeout: 900, //15mins
		WaitTimeSeconds: 0,
	}).promise()
	const msgs = Messages! || []
	logger(prefix, `received ${msgs.length} messages`)
	
	return msgs;
}

/** used in unit test for connectivity/package config */ 
export const getFile = async(Key: string)=> s3.getObject({ Bucket, Key }).promise()

/** memoize this function so we can just re-call it without worrying about performance */
const getFileHead = memoize(
	async(Key: string):Promise<{contentType: string, contentLength: number}>=> {
		const head = await s3.headObject({ Bucket, Key }).promise()
		return {
			contentType: head.ContentType!, 
			contentLength: head.ContentLength!,
		}
	},
	{ maxSize: 2 * NUM_FILES },
)

const releaseMessage = async(ReceiptHandle: string)=> sqs.changeMessageVisibility({
	QueueUrl,
	VisibilityTimeout: 0,
	ReceiptHandle,
}).promise()

// sum trues from array of booleans
const trueCount = (results: boolean[]) => results.reduce((acc, curr)=> curr ? ++acc : acc, 0)

export const harness = async()=> {
	console.log(prefix, `main begins`)
	/* message consumer loop */
	let promises: Promise<boolean>[] = []
	let booleans: boolean[] = []
	while(true){
		// logger(prefix, `num true promises on previous loop ${trueCount(booleans)} out of ${promises.length}`)
		// promises = []
		// booleans = []
		logger(prefix, {_currentNumFiles, _currentTotalSize})

		if(_currentNumFiles === NUM_FILES || _currentTotalSize >= TOTAL_FILESIZE){
			logger(prefix, `internal queue full. waiting 5000ms...`)
			logger(prefix, {vids: vidDownloads.listIds() })
			await sleep(5000)
			// await Promise.all(promises) //this needs to go
			continue;
		}

		const messages = await getMessages()
		if(messages.length === 0){
			await sleep(5000)
			continue;
		}
		for (const message of messages) {
			const s3event = JSON.parse(message.Body!) as S3Event
			/* check if it's an s3 event */
			if(s3event.Records && s3event.Records.length === 1 
				&& s3event.Records[0].eventName && s3event.Records[0].eventName.includes('ObjectCreated')
			){
				const s3Record = s3event.Records[0]
				const key = s3Record.s3.object.key
				const bucket = s3Record.s3.bucket.name
				logger(prefix, `found s3 event for '${key}' in '${bucket}`)

				/* process s3 event */

				//check we have room to add a new item
				const {contentLength, contentType} = await getFileHead(key)
				if(
					_currentNumFiles + 1 > NUM_FILES
					|| _currentTotalSize + contentLength > TOTAL_FILESIZE
				){
					//release this message back and try another
					await releaseMessage(message.ReceiptHandle!)
					continue;
				}
				_currentNumFiles++
				_currentTotalSize += contentLength

				//send to vid or image processing
				if(contentType.startsWith('video')){
					/* add to video download queue */
					await addToDownloads({
						content_size: contentLength.toString(),
						content_type: contentType,
						txid: key,
					})
				}else{
					/* process image */
					promises.push((async(contentLength:number)=>{
						const res = await checkImageTxid(key, contentType) 
						_currentNumFiles--
						_currentTotalSize -= contentLength
						return res;
					}) (contentLength) )
				}
				//process downloaded videos
				if(vidDownloads.length() > 0){
					await processVids()
					//cleanup aborted/errored downloads
					for (const dl of vidDownloads) {
						if(dl.complete === 'ERROR'){
							vidDownloads.cleanup(dl)
						}
					}
				}

				/* processing succesful, so delete event message from queue */
				await sqs.deleteMessage({
					QueueUrl,
					ReceiptHandle: message.ReceiptHandle!,
				}).promise()
			}else{
				logger(prefix, `error! unrecognized body. MessageId '${message.MessageId}'. not processing.`)
				console.log(`message.Body`, JSON.stringify(s3event, null,2))
			}
		}
	}
}


