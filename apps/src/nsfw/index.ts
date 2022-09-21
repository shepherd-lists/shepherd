import { SQS, S3 } from 'aws-sdk'
import { S3EventRecord } from 'aws-lambda'
import { logger } from '../common/utils/logger'

/* just gonna put this here until we refactor into its own service */
if(process.env.SQS_LOCAL === 'yes'){
	import('./minioToElasticmq')
}

//debug output for sanity
console.log(`process.env.AWS_SQS_INPUT_QUEUE`, process.env.AWS_SQS_INPUT_QUEUE)

const prefix = 'nsfw-main'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const sqs = new SQS({
	apiVersion: '2012-11-05',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' }),
	maxRetries: 10, //default 3
})
const QueueUrl = process.env.AWS_SQS_INPUT_QUEUE as string

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

const main = async()=> {
	while(true){
		const messages = await getMessages()
		for (const message of messages) {
			const s3event = JSON.parse(message.Body!) as S3EventRecord
			/* check if it's an s3 event */
			if(s3event.eventName && s3event.eventName.startsWith('s3:ObjectCreated:')){
				logger(prefix, `found s3 event for '${s3event.s3.object.key}'`)

				/* process s3 event */


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
main()


