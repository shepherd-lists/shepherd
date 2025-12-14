import { FilterErrorResult, FilterResult } from 'shepherd-plugin-interfaces'
import { logger } from './logger'
import { slackLogger } from './slackLogger'
import { sqs, AWS_INPUT_BUCKET, AWS_SQS_OUTPUT_QUEUE, AWS_SQS_SINK_QUEUE } from './aws-services'
import { S3EventRecord } from 'aws-lambda'

let count = 0
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

if (!AWS_SQS_OUTPUT_QUEUE) throw new Error('AWS_SQS_OUTPUT_QUEUE not defined')
if (!AWS_SQS_SINK_QUEUE) throw new Error('AWS_SQS_SINK_QUEUE not defined')
console.log('AWS_SQS_OUTPUT_QUEUE', AWS_SQS_OUTPUT_QUEUE)
console.log('AWS_SQS_SINK_QUEUE', AWS_SQS_SINK_QUEUE)
const ADDON_NAME = process.env.ADDON_NAME as string

export const sendOutputMsg = async (txid: string, filterResult: Partial<FilterResult | FilterErrorResult>) => {
	const _count = ++count

	// if flagged, send to chained output queue, otherwise bypass to final sink queue
	const QueueUrl = (filterResult.flagged === true) ? AWS_SQS_OUTPUT_QUEUE : AWS_SQS_SINK_QUEUE

	try {
		// Create S3 ObjectCreate event message
		const s3Event = {
			Records: [{
				eventVersion: "2.1",
				eventSource: "aws:s3",
				eventName: "ObjectCreated:Put",
				eventTime: new Date().toISOString(),
				s3: {
					s3SchemaVersion: "1.0",
					bucket: {
						name: AWS_INPUT_BUCKET,
						arn: `arn:aws:s3:::${AWS_INPUT_BUCKET}`
					},
					object: {
						key: txid,
						size: 0
					}
				},

			}] as S3EventRecord[],
			extra: { addonName: ADDON_NAME, filterResult } //http-api will process this
		}

		console.log(txid, `sending ${_count} to SQS ...`)
		let tries = 3
		while (true) {
			--tries
			try {
				const result = await sqs.sendMessage({
					QueueUrl, // final or output
					MessageBody: JSON.stringify(s3Event),
				}).promise()

				console.info(txid, `sent ${_count} to SQS`, result.MessageId)
				break;
			} catch (err0: unknown) {
				const e0 = err0 as Error
				if (tries > 0) {
					console.error(txid, 'error sending to SQS', e0.name, ':', e0.message, 'retrying...')
					await sleep(5_000)
					continue;
				} else {
					throw err0
				}
			}
		}

		return txid

	} catch (err: unknown) {
		const e = err as Error
		logger(txid, 'Error sending to SQS', e.name, ':', e.message, JSON.stringify(filterResult), e)
		slackLogger(txid, ':warning: Error sending to SQS after 3 tries', e.name, ':', e.message, JSON.stringify(filterResult), e)
		logger(txid, e) // `throw e` does nothing, use the return
	}
}


export const corruptDataConfirmed = async (txid: string) => {
	return sendOutputMsg(txid, {
		data_reason: 'corrupt',
	})
}

export const corruptDataMaybe = async (txid: string) => {
	return sendOutputMsg(txid, {
		data_reason: 'corrupt-maybe',
	})
}

export const partialImageFound = async (txid: string) => {
	return sendOutputMsg(txid, {
		data_reason: 'partial',
	})
}

export const partialVideoFound = async (txid: string) => {
	return sendOutputMsg(txid, {
		//@ts-expect-error data_reason doesn't include 'partial-seed'
		data_reason: 'partial-seed', //check later if fully seeded
	})
}

export const oversizedPngFound = async (txid: string) => {
	return sendOutputMsg(txid, {
		data_reason: 'oversized',
	})
}

/** @deprecated */
export const wrongMimeType = async (txid: string, content_type: string) => {
	const nonMedia = !content_type.startsWith('image') && !content_type.startsWith('video')
	return sendOutputMsg(txid, {
		err_message: content_type,
		data_reason: 'mimetype',
	})
}

export const unsupportedMimeType = async (txid: string) => {
	return sendOutputMsg(txid, {
		data_reason: 'unsupported',
	})
}
