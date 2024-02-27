import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { slackLog } from 'libs/utils/slackLog'


console.info('AWS_DEFAULT_REGION', process.env.AWS_DEFAULT_REGION)
console.info('AWS_REGION', process.env.AWS_REGION)

const s3client = new S3Client()


export const s3Exists = async (Bucket: string, Key: string) => {
	try {
		const head = await s3client.send(new HeadObjectCommand({ Bucket, Key }))
		return head.$metadata.httpStatusCode === 200
	} catch (err: unknown) {
		return (err as Error).name
	}
}

export const s3DeleteObject = async (Bucket: string, Key: string) => {
	return s3client.send(new DeleteObjectCommand({ Bucket, Key }))
}

export const s3UploadStream = async (Bucket: string, Key: string, Body: ReadableStream) => {

	try {
		const upload = new Upload({
			client: s3client,
			params: {
				Bucket,
				Key,
				ContentType: 'text/plain',
				Body,
			},
		})

		// Start the upload
		await upload.done()
		// upload completed successfully
	} catch (err: unknown) {
		const e = err as Error
		slackLog(s3UploadStream.name, Key, `UNHANDLED s3 upload error ${e.name}:${e.message}.`, e)
		throw e
	}
}

export const s3PutObject = async (Bucket: string, Key: string, text: string) => {
	const res = await s3client.send(new PutObjectCommand({
		Bucket,
		Key,
		ContentType: 'text/plain',
		Body: text,
	}))
	return res.$metadata.httpStatusCode
}

export const s3GetObjectStream = async (Bucket: string, Key: string) => {
	try {
		const { Body } = (await s3client.send(new GetObjectCommand({ Bucket, Key, })))
		return Body!.transformToWebStream()
	} catch (err: unknown) {
		const e = err as Error
		slackLog(s3GetObjectStream.name, Key, `UNHANDLED error ${e.name}:${e.message}.`, JSON.stringify(e))
		throw e
	}
}

export const s3GetObject = async (Bucket: string, Key: string) => {
	const res = await s3client.send(new GetObjectCommand({ Bucket, Key, }))
	return res.Body!.transformToString()
}
