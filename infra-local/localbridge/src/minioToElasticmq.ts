/**
 * the s3 event notification system on minio are not compatible with standard sqs queues
 * so we need to match the aws format & manually send these on with an event listener.
 */
import { Client } from 'minio'
import { SQS } from 'aws-sdk'
import { S3EventRecord, S3Event } from 'aws-lambda'

const prefix = '[localbridge]'
const bucketName = 'shepherd-input-mod-local'
const QueueUrl = 'http://sqs-local:9324/000000000000/shepherd-s3-events'

console.log(prefix, `starting.`)

const minio = new Client({
	endPoint: 's3-local',
	port: 9000,
	useSSL: false,
	accessKey: 'minioroot',
	secretKey: 'minioroot',
})

const sqs = new SQS({
	apiVersion: '2012-11-05',
	endpoint: 'http://sqs-local:9324', 
	region: 'dummy-value',
	maxRetries: 10, //default 3
})

minio.listenBucketNotification(
	bucketName,
	`*`,
	'*',
	['s3:ObjectCreated:*'],
).on('notification', (record: S3EventRecord) => {
	console.log(prefix, `forwarding '${record.s3.object.key}' s3 event to '${QueueUrl}' queue.`)
	//enclose s3 event and forward on in sqs message
	const s3event: S3Event = { 
		Records: [ record ] 
	}
	sqs.sendMessage({
		QueueUrl,
		MessageBody: JSON.stringify(s3event),
	}).promise()
})

