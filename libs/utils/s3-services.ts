import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, GetObjectTaggingCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { slackLog } from './slackLog'
import { PassThrough, Readable, Writable } from 'stream'


console.info('AWS_DEFAULT_REGION', process.env.AWS_DEFAULT_REGION)
console.info('AWS_REGION', process.env.AWS_REGION)

const s3client = new S3Client()


export const s3HeadObject = async (Bucket: string, Key: string) => s3client.send(new HeadObjectCommand({ Bucket, Key }))

export const s3ObjectTagging = async (Bucket: string, Key: string) => s3client.send(new GetObjectTaggingCommand({ Bucket, Key }))

export const s3DeleteObject = async (Bucket: string, Key: string) => s3client.send(new DeleteObjectCommand({ Bucket, Key }))

export const s3CheckFolderExists = async (Bucket: string, folder: string) => {
	const Prefix = folder.endsWith('/') ? folder : `${folder}/`
	try {
		await s3client.send(new ListObjectsV2Command({ Bucket, Prefix, MaxKeys: 1 }))
		return true
	} catch (e) {
		console.error(`could not find '${Prefix}' in ${Bucket}`, e)
		return false
	}
}

/** uses pagination */
export const s3ListFolderObjects = async (Bucket: string, folder: string) => {
	let continuationToken: string | undefined;
	let contents: any[] = [];
	const Prefix = folder.endsWith('/') ? folder : `${folder}/`;

	do {
		const response = await s3client.send(new ListObjectsV2Command({
			Bucket,
			Prefix, // specify the folder prefix here
			Delimiter: "/", // use a delimiter to list only objects in the folder
			ContinuationToken: continuationToken, // include theContinuationToken if present
		}));

		if (response.Contents) {
			contents = contents.concat(response.Contents);
		}

		continuationToken = response.IsTruncated ? response.ContinuationToken : undefined;
	} while (continuationToken);

	return contents.map((object) => object.Key); // return an array of file names
}

/** N.B. this will accept either a Readable or ReadableStream (nodejs or web stream)  */
export const s3UploadStream = async (Bucket: string, Key: string, Body: ReadableStream | Readable) => {

	try {
		const upload = new Upload({
			client: s3client,
			params: {
				Bucket,
				Key,
				ContentType: 'text/plain',
				Body,
			},
			// partSize: default = min = 5mb
			queueSize: 8, //default 4
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
export const s3UploadReadable = (Bucket: string, Key: string) => {
	const Body = new PassThrough({ autoDestroy: true, emitClose: true })
	const promise = s3UploadStream(Bucket, Key, Body)
	const customObject = Body as unknown as Writable & { promise: Promise<void> }
	customObject.promise = promise
	return customObject
}

export const s3PutObject = async ({ Bucket, Key, text, Sha1 }: { Bucket: string; Key: string; text: string; Sha1?: string }) => {
	const res = await s3client.send(new PutObjectCommand({
		Bucket,
		Key,
		ContentType: 'text/plain',
		Body: text,
		Tagging: Sha1 ? `SHA-1=${Sha1}` : undefined,
	}))
	return res.$metadata.httpStatusCode
}

export const s3GetObjectWebStream = async (Bucket: string, Key: string) => {
	try {
		const { Body } = (await s3client.send(new GetObjectCommand({ Bucket, Key, })))

		// //DEBUG
		// console.debug('s3GetObjectWebStream typeof Body', typeof Body)
		// if (Body instanceof ReadableStream) console.debug('s3GetObjectWebStream Body is a ReadableStream')
		// if (Body instanceof Readable) console.debug('s3GetObjectWebStream Body is a Readable')

		return Body!.transformToWebStream() // this should be consistent for nodejs and browser
	} catch (err: unknown) {
		const e = err as Error
		slackLog(s3GetObjectWebStream.name, Key, `UNHANDLED error ${e.name}:${e.message}.`, JSON.stringify(e))
		throw e
	}
}

export const s3GetObject = async (Bucket: string, Key: string) => {
	const res = await s3client.send(new GetObjectCommand({ Bucket, Key, }))
	return res.Body!.transformToString()
}
