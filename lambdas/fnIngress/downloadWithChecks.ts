import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { gatewayStream } from './gatewayStream'
import { fileTypeStream } from 'file-type'
import { Upload } from '@aws-sdk/lib-storage'
import { S3Client } from '@aws-sdk/client-s3'
import { ReadableStream } from 'node:stream/web'


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
export const processRecord = async (record: TxRecord) => {
	const bucket = process.env.AWS_INPUT_BUCKET!
	const key = record.txid
	let inputStream: ReadableStream | null = null

	try {
		//get input stream
		inputStream = await gatewayStream(record.txid)

		//create file type detection stream
		const fileTypeTransform = await fileTypeStream(inputStream, { sampleSize: 16_384 })

		//check file type before proceeding (fileType is available at this point)
		const detectedFileType = fileTypeTransform.fileType
		const allowedTypes = ['jpg', 'png', 'pdf', 'webp'] //test examples

		if (!detectedFileType || !allowedTypes.includes(detectedFileType.ext)) {
			//cancel streams for unsupported file types
			try {
				if (fileTypeTransform && typeof fileTypeTransform.cancel === 'function') {
					await fileTypeTransform.cancel()
				}
				if (inputStream && typeof inputStream.cancel === 'function') {
					await inputStream.cancel()
				}
			} catch (cleanupError) {
				console.warn(`Cleanup error for unsupported file type ${key}:`, cleanupError)
			}

			throw new Error(`Unsupported file type for ${record.txid}: ${detectedFileType?.ext || 'unknown'}. Allowed types: ${allowedTypes.join(', ')}`)
		}

		console.log(`File type detected for ${key}: ${detectedFileType.ext} (${detectedFileType.mime})`)

		//create and start S3 upload
		const upload = new Upload({
			client: s3client,
			params: {
				Bucket: bucket,
				Key: key,
				Body: fileTypeTransform as globalThis.ReadableStream, //fussy types, we want the nodejs iterator version
				ContentType: (detectedFileType.mime || record.content_type || 'application/octet-stream').replace(/\r|\n/g, ''),
			},
			queueSize: 8
		})

		//wait for upload completion
		await upload.done()

		return {
			txid: record.txid,
			success: true,
			key,
			bucket
		}
	} catch (error) {
		//cleanup streams on error
		try {
			if (inputStream && typeof inputStream.cancel === 'function') {
				await inputStream.cancel()
			}
		} catch (cleanupError) {
			console.warn(`Cleanup error for ${key}:`, cleanupError)
		}

		//handle specific error types we expect
		if (error instanceof Error) {
			if (error.message.includes('NetworkingError') || error.message.includes('timeout')) {
				throw new Error(`Network error processing ${record.txid}: ${error.message}`)
			}
			if (error.message.includes('NoSuchBucket') || error.message.includes('AccessDenied')) {
				throw new Error(`S3 access error processing ${record.txid}: ${error.message}`)
			}
			if (error.message.includes('404') || error.message.includes('not found')) {
				throw new Error(`Transaction not found ${record.txid}: ${error.message}`)
			}
		}

		throw new Error(`Failed to process ${record.txid}: ${error instanceof Error ? error.message : 'Unknown error'}`)
	}
}
