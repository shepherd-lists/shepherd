import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { gatewayStream } from './gatewayStream'
import { fileTypeStream } from 'file-type'
import { Upload } from '@aws-sdk/lib-storage'
import { S3Client } from '@aws-sdk/client-s3'
import { ReadableStream } from 'node:stream/web'
import { slackLog } from '../../libs/utils/slackLog'
import { chunkTxDataStream } from './chunkTxDataStream'



const s3client = new S3Client({})


type SourceStream = typeof chunkTxDataStream | typeof gatewayStream

export const downloadWithChecks = async (records: TxRecord[], sourceStream?: SourceStream) => Promise.all(records.map(async (record) => await processRecord(record, sourceStream)))


/** exported for testing only */
export const processRecord = async (
	record: TxRecord,
	/** dependency injection */
	sourceStream: SourceStream = chunkTxDataStream,
): Promise<{ queued: boolean; record: TxRecord; errorId?: string }> => {

	const bucket = process.env.AWS_INPUT_BUCKET!
	const key = record.txid
	let inputStream: ReadableStream | null = null
	let upload: Upload | null = null

	try {
		//get input stream
		if (sourceStream === gatewayStream) {
			inputStream = await (sourceStream as typeof gatewayStream)(record.txid)
		} else {
			inputStream = await (sourceStream as typeof chunkTxDataStream)(record.txid, record.parent || null, record.parents)
		}

		//create file type detection stream
		const fileTypeTransform = await fileTypeStream(inputStream, { sampleSize: 16_384 })

		//check file type before proceeding (fileType is available at this point)
		const detectedMime = fileTypeTransform.fileType?.mime
		const recordMime = record.content_type

		if (
			(detectedMime === 'application/xml' && recordMime === 'image/svg+xml') //file-type quirk
			|| detectedMime?.startsWith('image')
			|| detectedMime?.startsWith('video')
			|| detectedMime?.startsWith('audio')
			|| detectedMime === undefined
		) {
			console.info(record.txid, `proceeding with stream, detectedMime: "${detectedMime}", recordMime: "${recordMime}"`)
		} else {
			try {
				console.info(record.txid, `cancelling stream, detectedMime: "${detectedMime}", recordMime: "${recordMime}"`)
				await fileTypeTransform.cancel('unsupported file type')
			} catch (e) {
				slackLog(record.txid, 'error cancelling stream', e)
			}
			return {
				queued: false,
				record: {
					...record,
					flagged: false,
					valid_data: false,
					data_reason: 'mimetype',
					content_type: detectedMime,
					last_update_date: new Date(),
				}
			}
		}

		//last update before upload
		record.valid_data = true
		record.last_update_date = new Date()

		//create and start S3 upload
		upload = new Upload({
			client: s3client,
			params: {
				Bucket: bucket,
				Key: key,
				Body: fileTypeTransform as globalThis.ReadableStream, //fussy types, we want the nodejs iterator version
				ContentType: (detectedMime || record.content_type || 'application/octet-stream').replace(/\r|\n/g, ''),
				Metadata: { txrecord: JSON.stringify(record) } //only lowercase supported in key name!!
			},
			queueSize: 8
		})

		//wait for upload completion
		await upload.done()

		return {
			queued: true,
			record,
		}

	} catch (e) {
		//abort S3 upload if it was started
		if (upload) {
			try {
				await upload.abort()
				console.info(`Aborted S3 upload for ${key}`)
			} catch (abortError) {
				slackLog(key, 'S3 upload abort failed', abortError)
			}
		}

		//cleanup streams on error
		try {
			if (inputStream) {
				await inputStream.cancel()
			}
		} catch (cleanupError) {
			console.warn(`Cleanup error for ${key}:`, cleanupError)
		}

		//handle specific error types we expect
		if (e instanceof Error) {
			if (e.message.includes('404') || e.message.includes('not found')) {
				return {
					queued: false,
					record: {
						...record,
						flagged: false,
						valid_data: false,
						data_reason: '404',
						last_update_date: new Date(),
					}
				}
			}
			if (e.message.includes('NO_DATA')) {
				return {
					queued: false,
					record: {
						...record,
						flagged: false,
						valid_data: false,
						data_reason: 'nodata',
						last_update_date: new Date(),
					}
				}
			}
			console.error(`Failed to process ${record.txid}: ${e}`)
			return {
				queued: false,
				record,
				errorId: e.message, //should be retried
			}
		}

		//shouldn't get here
		throw new Error(`Failed to process ${record.txid}: ${e}`)
	}
}
