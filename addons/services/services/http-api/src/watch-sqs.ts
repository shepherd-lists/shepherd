/** fetch messages from final SQS and process them. using aws-sdk v3 and keep waiting for new messages. */

import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, Message } from '@aws-sdk/client-sqs'
import { slackLog } from '../../../libs/utils/slackLog'
import { FilterErrorResult, FilterResult } from 'shepherd-plugin-interfaces'
import { S3EventRecord } from 'aws-lambda'
import { s3HeadObject } from '../../../libs/utils/s3-services'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { sqsFinalHandler } from './sqsFinalHandler'

const prefix = 'watch-sqs'

const sqsClient = new SQSClient({
	// ...(process.env.SQS_LOCAL === 'yes' && { endpoint: 'http://sqs-local:9324', region: 'dummy-value' }),
	maxAttempts: 10,
	// retryMode: 'adaptive',
})


const AWS_SQS_SINK_QUEUE = process.env.AWS_SQS_SINK_QUEUE as string | undefined //undefined if no classifiers
const AWS_INPUT_BUCKET = process.env.AWS_INPUT_BUCKET as string

[AWS_INPUT_BUCKET].forEach(env => {
	if (!env) throw new Error(`${env} is not configured`)
})


/** Process a single SQS message */
const processMessage = async (message: Message): Promise<void> => {
	if (!message.Body) {
		slackLog(prefix, 'Received message without body', message.MessageId)
		return
	}

	interface CustomS3Event {
		Records: S3EventRecord[] //we only use 1 record ever.
		extra: {
			addonName: string
			filterResult: Partial<FilterResult | FilterErrorResult>
		}
	}

	try {
		const body: CustomS3Event = JSON.parse(message.Body)

		console.debug(prefix, 'extra', body.extra)

		if (!body.extra) {
			throw new Error(`Invalid message format: extra is missing.${JSON.stringify(body)} `)
		}

		/** compile final TxRecord from s3 metadata and plugin result */
		const txid = body.Records[0].s3.object.key
		const s3Head = await s3HeadObject(AWS_INPUT_BUCKET, txid)
		const s3Txrecord = JSON.parse(s3Head.Metadata!.txrecord!) as TxRecord

		const finalTxrecord = { ...s3Txrecord, ...body.extra.filterResult } as TxRecord //there's potential for a type mismatch here, nothing serious

		console.log(prefix, `Processing message for txid: ${txid} ...`)

		await sqsFinalHandler(txid, finalTxrecord)


		console.log(prefix, `Successfully processed txid: ${txid} `)

	} catch (err: unknown) {
		const e = err as Error
		console.error(prefix, 'Error processing message', message.MessageId, e.message)
		throw e // Re-throw to prevent message deletion
	}
}

/** Delete a message from the queue after successful processing */
const deleteMessage = async (receiptHandle: string) => sqsClient.send(new DeleteMessageCommand({
	QueueUrl: AWS_SQS_SINK_QUEUE,
	ReceiptHandle: receiptHandle,
}))

/** Poll SQS for messages and process them */
const pollQueue = async (): Promise<void> => {

	console.info(prefix, `Starting to poll queue: ${AWS_SQS_SINK_QUEUE} `)

	while (true) {
		try {
			const response = await sqsClient.send(new ReceiveMessageCommand({
				QueueUrl: AWS_SQS_SINK_QUEUE,
				MaxNumberOfMessages: 10, // Process up to 10 messages at a time
				WaitTimeSeconds: 20, // Long polling to reduce empty responses
				VisibilityTimeout: 300, // 5 minutes to process the message
			}))

			if (response.Messages && response.Messages.length > 0) {
				console.log(prefix, `Received ${response.Messages.length} messages`)

				// Process messages sequentially to avoid overwhelming the system
				for (const message of response.Messages) {
					try {
						await processMessage(message)

						// Delete message only after successful processing
						if (message.ReceiptHandle) {
							await deleteMessage(message.ReceiptHandle)
							console.log(prefix, `Deleted message ${message.MessageId} `)
						}
					} catch (err: unknown) {
						const e = err as Error
						console.error(prefix, `Failed to process message ${message.MessageId}: `, e.message)
						// Message will become visible again after VisibilityTimeout
						// and will be retried or sent to DLQ based on queue configuration
					}
				}
			} else {
				// No messages received, continue polling
				console.debug(prefix, 'No messages received, continuing to poll...')
			}
		} catch (err: unknown) {
			const e = err as Error
			console.error(prefix, 'Error polling queue:', e.message)
			await slackLog(prefix, 'Error polling SQS queue', e.message)

			// Wait before retrying to avoid tight error loop
			await new Promise(resolve => setTimeout(resolve, 5000))
		}
	}
}

/** Start the SQS watcher (self-starting) */
if (AWS_SQS_SINK_QUEUE) {
	console.info(prefix, 'SQS watcher enabled')
	pollQueue().catch(err => {
		slackLog(prefix, 'Fatal error in SQS watcher', String(err))
		throw err //crash the service?
	})
} else {
	console.info(prefix, 'SQS watcher disabled (no classifiers). AWS_SQS_SINK_QUEUE =', AWS_SQS_SINK_QUEUE)
}
