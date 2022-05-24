import { S3 } from 'aws-sdk'
import { Readable } from 'stream'
import { logger } from '../common/utils/logger'

const prefix = 's3stream'

console.assert(process.env.AWS_DEFAULT_REGION, 'process.env.AWS_DEFAULT_REGION is undefined')
console.assert(process.env.AWS_ACCESS_KEY_ID, 'process.env.AWS_ACCESS_KEY_ID is undefined')
console.assert(process.env.AWS_SECRET_ACCESS_KEY, 'process.env.AWS_SECRET_ACCESS_KEY is undefined')
console.assert(process.env.AWS_INPUT_BUCKET, 'process.env.AWS_INPUT_BUCKET is undefined')


const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.S3_LOCAL==='yes' && { 
		endpoint: process.env.S3_LOCAL_ENDPOINT!,
		accessKeyId: 'minioroot',
		secretAccessKey: 'minioroot',
		s3ForcePathStyle: true, // *** needed with minio ***
	 }),
})

const bucketName = process.env.AWS_INPUT_BUCKET as string

export const s3Stream = async(readable: Readable, mimetype: string, txid: string)=> {

	logger(prefix, 'uploading', txid, mimetype)

	readable.on('error',e=>{
		if(['NO_DATA', 'BAD_MIME'].includes(e.message)){ 
			logger(prefix, 'aborting. error', e.message, txid)
			uploader.abort() 
		}else{
			logger(prefix, 'UNHANDLED error', e)
		}
	})

	let uploader: S3.ManagedUpload
	try{
		uploader = s3.upload({
			Bucket: bucketName,
			Key: txid,
			ContentType: mimetype,
			Body: readable,
		})
		const data = await uploader.promise()
		logger(prefix, 'uploaded buffer. Location', data.Location)
		return 'OK';
	}catch(e){
		if(e instanceof Error){
			if(e.name === 'RequestAbortedError'){
				// not an error. we requested to abort
				return 'ABORTED';
			}
			logger(prefix, 'UNHANDLED S3 ERROR', e.name,':',e.message)
		}
		//just throw stuff like NoSuchBucket, UnknownEndpoint, etc. needs to be handled externally
		throw e;	
	}
}

export const s3Delete = async (txid: string) => {
	logger(prefix, `deleting ${txid} ...`)
	
	await s3.deleteObject({
		Bucket: bucketName,
		Key: txid,
	}).promise()
	
	logger(prefix, `sent delete command on ${txid} without throwing error`)
}