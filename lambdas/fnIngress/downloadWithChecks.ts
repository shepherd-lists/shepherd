import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { gatewayStream } from './gatewayStream'
import { fileTypeStream } from 'file-type'
import { Upload } from '@aws-sdk/lib-storage'
import { S3Client } from '@aws-sdk/client-s3'
import { ReadableStream } from 'node:stream/web'
import { slackLog } from '../../libs/utils/slackLog'
import { chunkTxDataStream } from './chunkTxDataStream'


const s3client = new S3Client({})

export const downloadWithChecks = async (records: TxRecord[]) => {
	const results = []

	for (const record of records) {
		try {
			const result = await processRecord(record)
			results.push(result)
		} catch (error) {
			results.push({
				txid: record.txid,
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			})
		}
	}

	return results
}

/** exported for testing only */
export const processRecord = async (record: TxRecord): Promise<{ queued: boolean, record: TxRecord }> => {
	const bucket = process.env.AWS_INPUT_BUCKET!
	const key = record.txid
	let inputStream: ReadableStream | null = null

	try {
		//get input stream
		inputStream = await chunkTxDataStream(record.txid, record.parent || null, record.parents)

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
		const upload = new Upload({
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

			//PLACEHOLDERS
			if (e.message.includes('NetworkingError') || e.message.includes('timeout')) {
				//retry?
				throw new Error(`Network error processing ${record.txid}: ${e.message}`)
			}
			if (e.message.includes('NoSuchBucket') || e.message.includes('AccessDenied')) {
				throw new Error(`S3 access error processing ${record.txid}: ${e.message}`)
			}
		}

		throw new Error(`Failed to process ${record.txid}: ${e instanceof Error ? e.message : 'Unknown error'}`)
	}
}
