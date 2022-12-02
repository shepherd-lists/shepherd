import { AWSError, SQS } from 'aws-sdk'
import { s3, sqs, AWS_INPUT_BUCKET, AWS_SQS_INPUT_QUEUE } from './utils/aws-services'
import { S3Event } from 'aws-lambda'
import { logger } from './utils/logger'
import memoize from 'micro-memoize'
import { VidDownloads } from './rating/video/VidDownloads'
import { addToDownloads } from './rating/video/downloader'
import { processVids } from './rating/video/process-files'
import { checkImageTxid } from './rating/filter-host'
import { slackLogger } from './utils/slackLogger'

const prefix = 'nsfw-main'

//debug output for sanity
console.log(`process.env.NUM_FILES`, process.env.NUM_FILES)
const NUM_FILES = +process.env.NUM_FILES!
console.log(`process.env.TOTAL_FILESIZE_GB`, process.env.TOTAL_FILESIZE_GB)
const TOTAL_FILESIZE = +process.env.TOTAL_FILESIZE_GB! * 1024 * 1024 * 1024


const _currentVideos = VidDownloads.getInstance()

//keep track and set limits based on env inputs
let _currentTotalSize = 0
let _currentNumFiles = 0
let _currentImageIds: {[name:string]:any} = {}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const getMessages = async(maxNumberOfMessages: number): Promise<SQS.Message[]> => {
	const { Messages } = await sqs.receiveMessage({
		QueueUrl: AWS_SQS_INPUT_QUEUE,
		MaxNumberOfMessages: Math.min(10, maxNumberOfMessages),
		MessageAttributeNames: ['All'],
		VisibilityTimeout: 900, //15mins
		WaitTimeSeconds: 0,
	}).promise()
	const msgs = Messages! || []
	logger(prefix, `received ${msgs.length} messages`)
	
	return msgs;
}

/** used in unit test for connectivity/package config */ 
export const getFile = async(Key: string)=> s3.getObject({ Bucket: AWS_INPUT_BUCKET, Key }).promise()

/** memoize this function so we can just re-call it without worrying about performance */
const getFileHead = memoize(
	async(Key: string, ReceiptHandle: string):Promise<{contentType: string, contentLength: number} | undefined>=> {
		while(true){
			try {
				const head = await s3.headObject({ Bucket: AWS_INPUT_BUCKET, Key }).promise()
				logger(`getFileHead`, Key, `info. head returned ${head.ContentType}, OK.`)
				return {
					contentType: head.ContentType!, 
					contentLength: head.ContentLength!,
				}
			}catch(err){
				let e = err as AWSError
				if(e.statusCode === 404 || e.statusCode === 403){
					logger(`getFileHead`, Key, `warning! ${e.name}(${e.statusCode}):${e.message}. deleting message...`)
					deleteMessage(ReceiptHandle, Key)
					return undefined;
				}
				logger(`getFileHead`, Key, `warning! ${e.name}(${e.statusCode}):${e.message}. retrying...`, e)
				slackLogger(`getFileHead`, Key, `warning! ${e.name}(${e.statusCode}):${e.message}. retrying...`, e)
			}
		}
	},
	{ maxSize: 2 * NUM_FILES },
)

const releaseMessage = async(ReceiptHandle: string)=> sqs.changeMessageVisibility({
	QueueUrl: AWS_SQS_INPUT_QUEUE,
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
		logger(prefix, {_currentNumFiles, _currentTotalSize: _currentTotalSize.toLocaleString(), vids: _currentVideos.length(), imgs: Object.keys(_currentImageIds).length})

		if(_currentNumFiles >= NUM_FILES || _currentTotalSize >= TOTAL_FILESIZE){
			logger(prefix, `internal queue full. waiting 1000ms...`)
			logger(prefix, {vids: _currentVideos.listIds(), imgs: _currentImageIds })
			await sleep(1000)
			// await Promise.all(promises) //this needs to go
			continue;
		}

		const messages = await getMessages( Math.max(0, NUM_FILES - _currentNumFiles) )
		if(messages.length === 0){
			await sleep(5000)
			continue;
		}
		messages.forEach(async message => {
			const s3event = JSON.parse(message.Body!) as S3Event
			/* check if it's an s3 event */
			if(s3event.Records && s3event.Records.length === 1 
				&& s3event.Records[0].eventName && s3event.Records[0].eventName.includes('ObjectCreated')
			){
				const s3Record = s3event.Records[0]
				const key = s3Record.s3.object.key
				const receiptHandle = message.ReceiptHandle!
				// const bucket = s3Record.s3.bucket.name
				// logger(prefix, `found s3 event for '${key}' in '${bucket}`)

				/* process s3 event */

				//check we have room to add a new item (& that object exists)
				const headRes = await getFileHead(key, receiptHandle)
				if(!headRes) return false;

				const {contentLength, contentType} = headRes
				const videoLength = contentType.startsWith('video/') ? contentLength : 0 //images don't get stored in VID_TMPDIR
				if(_currentTotalSize + videoLength > TOTAL_FILESIZE){
					logger(prefix, key, `no room for this ${contentLength.toLocaleString()} byte file. releasing back to queue (aware DLQ)`, {_currentNumFiles, _currentTotalSize})
					await releaseMessage(message.ReceiptHandle!) //message may end up in DLQ if this is excessive.
					return;
				}
				if(_currentNumFiles > NUM_FILES) logger(prefix, `Warning. queue overflow`, {_currentNumFiles})
				
				_currentNumFiles++
				_currentTotalSize += videoLength

				//send to vid or image processing
				if(contentType.startsWith('video')){
					/* add to video download queue */
					await addToDownloads({
						content_size: contentLength.toString(),
						content_type: contentType,
						txid: key,
						receiptHandle,
					})
				}else{
					/* process image */
					promises.push((async(
						key: string,
						videoLength:number,
						receiptHandle:string,
					)=>{
						_currentImageIds[key] = 1
						let res = false
						try{
							res = await checkImageTxid(key, contentType) 
						}catch(e){
							console.log(key, `****** UNCAUGHT ERROR ********* in anon-image handler`, e)
							slackLogger(key, `****** UNCAUGHT ERROR ********* in anon-image handler`, e)
						}
						logger(key, `checkImageTxid`, res)
						cleanupAfterProcessing(receiptHandle, key, videoLength)
						delete _currentImageIds[key]
						return res;
					}) (key, videoLength, receiptHandle) )
				}
				//process downloaded videos
				if(_currentVideos.length() > 0){
					processVids().then(()=>{
						//cleanup aborted/errored downloads
						for (const item of _currentVideos) {
							if(item.complete === 'ERROR'){
								_currentVideos.cleanup(item)
							}
						}
					})
				}

			}else{
				logger(prefix, `error! unrecognized body. MessageId '${message.MessageId}'. not processing.`)
				console.log(`message.Body`, JSON.stringify(s3event, null,2))
			}
		})// end messages.forEach
	}
}

/* processing succesful, so delete event message + object */
export const cleanupAfterProcessing = (ReceiptHandle: string, Key: string, videoLength: number)=> {
	logger(cleanupAfterProcessing.name, `called for ${Key}`)
	_currentNumFiles--
	_currentTotalSize -= videoLength

	deleteMessage(ReceiptHandle, Key)
	
	s3.deleteObject({
		Bucket: AWS_INPUT_BUCKET,
		Key,
	}).promise()
		// .then(()=> logger(Key, `deleted object`))
		.catch((e: AWSError) => logger(Key, `ERROR DELETING OBJECT! ${e.name}(${e.statusCode}):${e.message} => ${e.stack}`))
}

const deleteMessage = (ReceiptHandle: string, Key: string)=> sqs.deleteMessage({
	QueueUrl: AWS_SQS_INPUT_QUEUE,
	ReceiptHandle,
}).promise()
	// .then(()=> logger(Key, `deleted message`))
	.catch((e: AWSError) => logger(Key, `ERROR DELETING MESSAGE! ${e.name}(${e.statusCode}):${e.message} => ${e.stack}`))


