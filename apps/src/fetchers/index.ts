import { SQS } from 'aws-sdk'


const prefix = 'feeder'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const sqs = new SQS({
	apiVersion: '2012-11-05',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' })
})
console.log('sqs.config.endpoint', sqs.config.endpoint)

const main = async()=> {
	while(true){
		const { Messages, $response } = await sqs.receiveMessage({
			QueueUrl: process.env.AWS_FEEDER_QUEUE as string,
			// AttributeNames: ['SentTimestamp'],
			MaxNumberOfMessages: 10,
			MessageAttributeNames: ['All'],
			VisibilityTimeout: 20,
			WaitTimeSeconds: 0,
		}).promise()
		if(Messages){
			console.log(`received ${Messages.length} messages`)

			const deleted = await Promise.all(Messages.map(msg=>{
				return sqs.deleteMessage({
					ReceiptHandle: msg.ReceiptHandle!,
					QueueUrl: process.env.AWS_FEEDER_QUEUE as string,
				}).promise()
			}))
			console.log(`deleted ${deleted.length} messages.`)

		}else{
			console.log('no messages')
			await sleep(5000)
		}
	}
}
main()