/**
 * Manually send a flagged SQS message for a given txid.
 *
 * Creates an S3 object with the REAL partial TxRecord in metadata (as expected
 * by watch-sqs.ts), then sends a message to the finalQueueName queue with
 * flagged=true in the filterResult. watch-sqs merges the two to produce the
 * final TxRecord passed to sqsFinalHandler.
 *
 * Usage:
 *   npx tsx flag-txid.ts <txid>
 *
 * Required env vars: AWS_INPUT_BUCKET (+ standard AWS credentials/region), SHEPHERD_CONFIG=../../../config.frankfurt.ts
 */
import 'dotenv/config'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { SQSClient, SendMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs'
import { arGql } from 'ar-gql'
import type { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { buildRecords } from '../lambdas/fnIngress/index'
import { finalQueueName } from '../../../Config'
import type { Config } from '../../../Config'
import type { FilterResult } from 'shepherd-plugin-interfaces'

const [, , ...args] = process.argv
const txid = args[0]

if (!txid) {
	console.error('Usage: npx tsx flag-txid.ts <txid>')
	console.error('Example: npx tsx flag-txid.ts abc123')
	process.exit(1)
}

const AWS_INPUT_BUCKET = process.env.AWS_INPUT_BUCKET
if (!AWS_INPUT_BUCKET) throw new Error('AWS_INPUT_BUCKET env var is required')

const configModule = await import(new URL(process.env.CONFIG!, import.meta.url).href)
const config: Config = configModule.config

const queueName = finalQueueName(config)
if (!queueName) throw new Error('finalQueueName returned undefined — config has no classifiers')

// Resolve the full queue URL from the queue name
const sqsClient = new SQSClient({})
const { QueueUrl } = await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }))
if (!QueueUrl) throw new Error(`Could not resolve URL for queue: ${queueName}`)

console.info(`Target queue: ${queueName}`)
console.info(`Queue URL:    ${QueueUrl}`)

// Fetch real tx metadata from GQL and build a proper TxRecord for S3 metadata.
// watch-sqs.ts merges S3 metadata with body.extra.filterResult, so flagged=true
// comes from the SQS message rather than here.
const gqlUrl = config.gql_url_secondary ?? 'https://arweave-search.goldsky.com/graphql'
const gql = arGql({ endpointUrl: gqlUrl })

console.info(`Fetching tx metadata for ${txid} from ${gqlUrl} ...`)
const node = await gql.tx(txid)
const meta: GQLEdgeInterface = { cursor: '', node }
const [record] = await buildRecords([meta], gql, 'flag-txid', 'flag-txid.ts', gql)
if (!record) throw new Error(`buildRecords returned no record for ${txid}`)

// Upload the S3 object with real TxRecord metadata
const s3Client = new S3Client({ forcePathStyle: true })
await s3Client.send(new PutObjectCommand({
	Bucket: AWS_INPUT_BUCKET,
	Key: txid,
	Body: txid, //dont need the actual data - this will make an actual classifier choke i guess? little test on it's own
	ContentType: record.content_type,
	Metadata: { txrecord: JSON.stringify({ ...record, data_reason: 'manually-flagged' }) },
}))
console.info(`Uploaded S3 object: s3://${AWS_INPUT_BUCKET}/${txid} (content_type: ${record.content_type}, size: ${record.content_size})`)

// Send the SQS message in the CustomS3Event format consumed by watch-sqs.ts.
// filterResult spreads over the S3 TxRecord, so flagged=true overrides the metadata value.
const filterResult: FilterResult = {
	flagged: true,
	flag_type: 'matched',
}
await sqsClient.send(new SendMessageCommand({
	QueueUrl,
	MessageBody: JSON.stringify({
		Records: [{
			eventVersion: '2.1',
			eventSource: 'aws:s3',
			eventName: 'ObjectCreated:Put',
			eventTime: new Date().toISOString(),
			s3: {
				s3SchemaVersion: '1.0',
				bucket: {
					name: AWS_INPUT_BUCKET,
					arn: `arn:aws:s3:::${AWS_INPUT_BUCKET}`,
				},
				object: {
					key: txid,
					size: 0,
				},
			},
		}],
		extra: {
			addonName: new URL(import.meta.url).pathname.split('/').pop(),
			filterResult,
		},
	}),
}))
console.info(`Sent flagged SQS message for ${txid} to ${queueName}`)
