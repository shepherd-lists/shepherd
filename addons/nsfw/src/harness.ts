import { SQS, S3 } from 'aws-sdk'
import { S3Event } from 'aws-lambda'
import { logger } from './utils/logger'

const prefix = 'nsfw-main'


//debug output for sanity
console.log(`process.env.AWS_SQS_INPUT_QUEUE`, process.env.AWS_SQS_INPUT_QUEUE)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const sqs = new SQS({
	apiVersion: '2012-11-05',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' }),
	maxRetries: 10, //default 3
})
const QueueUrl = process.env.AWS_SQS_INPUT_QUEUE as string

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

export const getFile = async(Bucket:string, Key: string)=> {
	try{
		console.log({Bucket, Key})
		const res = await s3.getObject({ Bucket, Key }).promise()
		return res
	}catch(e){
		console.log(prefix, `some error happened in ${getFile.name}. throwing`)
		throw e;
	}
}

export const main = async()=> {
	console.log(prefix, `main begins`)
	while(true){
		const messages = await getMessages()
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

				const res = await getFile(bucket, key)

				console.log(`got object. contentType '${res.ContentType}'`)


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
		await sleep(5000)
	}
}


