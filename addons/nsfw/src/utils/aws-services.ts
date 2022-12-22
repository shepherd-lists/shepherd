import { SQS, S3, STS } from 'aws-sdk'
 
/* exports */
export { AWSError } from 'aws-sdk'

export const AWS_SQS_INPUT_QUEUE = process.env.AWS_SQS_INPUT_QUEUE as string
export const AWS_INPUT_BUCKET = process.env.AWS_INPUT_BUCKET as string

export const sqs = new SQS({
	apiVersion: '2012-11-05',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' }),
	maxRetries: 10, //default 3
})

export const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.S3_LOCAL==='yes' && { 
		endpoint: process.env.S3_LOCAL_ENDPOINT!, 
		region: 'dummy-value',
		s3ForcePathStyle: true, // *** needed with minio ***
	}),
	maxRetries: 10, 
})

/* sanity checks */

//env vars
console.log(`process.env.SQS_LOCAL`, process.env.SQS_LOCAL)
console.log(`process.env.S3_LOCAL`, process.env.S3_LOCAL)
console.log(`process.env.AWS_SQS_INPUT_QUEUE`, process.env.AWS_SQS_INPUT_QUEUE)
console.log(`process.env.AWS_INPUT_BUCKET`, process.env.AWS_INPUT_BUCKET)

//check aws role (dont call locally)
const checkAwsRole = async () => {
	const sts = new STS({apiVersion: '2011-06-15'})
	const identity = await sts.getCallerIdentity().promise()
	console.log(`*** CALLER IDENTITY ***`, identity)
}
process.env.SQS_LOCAL !== 'yes' && checkAwsRole()
console.log(`sqs.config.endpoint`, sqs.config.endpoint)
console.log(`s3.config.endpoint`, s3.config.endpoint)
