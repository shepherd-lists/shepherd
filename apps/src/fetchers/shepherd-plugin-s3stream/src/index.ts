// require('dotenv').config()
import { StreamPluginInterface, INFLIGHT_CONST } from '../../../shepherd-plugin-interfaces'
import { S3 } from 'aws-sdk'
import { Readable } from 'stream'

const prefix = '[s3stream-plugin]'

console.assert(process.env.AWS_DEFAULT_REGION, 'process.env.AWS_DEFAULT_REGION is undefined')
console.assert(process.env.AWS_ACCESS_KEY_ID, 'process.env.AWS_ACCESS_KEY_ID is undefined')
console.assert(process.env.AWS_SECRET_ACCESS_KEY, 'process.env.AWS_SECRET_ACCESS_KEY is undefined')
console.assert(process.env.AWS_INPUT_BUCKET, 'process.env.AWS_INPUT_BUCKET is undefined')


// const s3 = new AWS.S3({ apiVersion: '2006-03-01' })
const s3 = new S3({
	apiVersion: '2006-03-01',
	endpoint: 'http://s3-local-test:9000',
	accessKeyId: 'minioroot',
	secretAccessKey: 'minioroot',
	s3ForcePathStyle: true, // *** needed with minio ***
})

const bucketName = process.env.AWS_INPUT_BUCKET as string

const checkStream = async(read: Readable, mimetype: string, txid: string)=> {

	console.log(prefix, 'uploading', txid, mimetype)

	read.on('error',e=>{
		if(e.message === 'NO_DATA'){ 
			console.log(prefix, 'error', e.message, txid)
			uploader.abort() 

		}else{
			console.log(prefix, 'error', e)
		}
	})

	let uploader: S3.ManagedUpload
	try{
		uploader = s3.upload({
			Bucket: bucketName,
			Key: txid,
			ContentType: mimetype,
			Body: read,
		})
		const data = await uploader.promise()
		console.log(prefix, 'uploaded buffer. Location', data.Location)
		return 'OK';
	}catch(e){
		if(e instanceof Error){
			if(e.name === 'RequestAbortedError'){
				// not an error. we requested to abort
				return 'NO_DATA';
			}
			console.log('UNHANDLED S3 ERROR', e.name,':',e.message)
		}
		//just throw stuff like NoSuchBucket, UnknownEndpoint, etc. needs to be handled externally
		throw e;	
	}
}


const StreamPlugin: StreamPluginInterface = {
	checkStream,
}
export default StreamPlugin;