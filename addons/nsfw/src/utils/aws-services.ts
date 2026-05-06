import { SQS, S3, STS } from 'aws-sdk'

/* exports */
export { AWSError } from 'aws-sdk'

export const AWS_INPUT_BUCKET = process.env.AWS_INPUT_BUCKET as string
export const AWS_SQS_INPUT_QUEUE = process.env.AWS_SQS_INPUT_QUEUE as string
export const AWS_SQS_OUTPUT_QUEUE = process.env.AWS_SQS_OUTPUT_QUEUE as string
export const AWS_SQS_SINK_QUEUE = process.env.AWS_SQS_SINK_QUEUE as string

export const sqs = new SQS({
	apiVersion: '2012-11-05',
	endpoint: process.env.AWS_ENDPOINT_URL_SQS,
	region: process.env.AWS_REGION || 'us-east-1',
	maxRetries: 10,
})

export const s3 = new S3({
	apiVersion: '2006-03-01',
	endpoint: process.env.AWS_ENDPOINT_URL_S3,
	s3ForcePathStyle: true,
	region: process.env.AWS_REGION || 'us-east-1',
	maxRetries: 10,
})

/* sanity checks */

//env vars
console.log('process.env.SQS_LOCAL', process.env.SQS_LOCAL)
console.log('process.env.S3_LOCAL', process.env.S3_LOCAL)
console.log('process.env.AWS_SQS_INPUT_QUEUE', process.env.AWS_SQS_INPUT_QUEUE)
console.log('process.env.AWS_SQS_OUTPUT_QUEUE', process.env.AWS_SQS_OUTPUT_QUEUE)
console.log('process.env.AWS_INPUT_BUCKET', process.env.AWS_INPUT_BUCKET)
console.log('process.env.AWS_SQS_SINK_QUEUE', process.env.AWS_SQS_SINK_QUEUE)

console.log('sqs.config.endpoint', sqs.config.endpoint)
console.log('s3.config.endpoint', s3.config.endpoint)
