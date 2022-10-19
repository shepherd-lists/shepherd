import axios from "axios";
import fs from 'fs'
import filetype, { FileTypeResult } from "file-type";
import { IncomingMessage } from "http";
import { network_EXXX_codes, NO_STREAM_TIMEOUT, VID_TMPDIR, VID_TMPDIR_MAXSIZE } from "../../constants";
import { logger } from "../../utils/logger";
import { dbNoDataFound, dbNoDataFound404, dbNoMimeType, dbPartialVideoFound, dbWrongMimeType } from "../../utils/db-update-txs";
import { VidDownloadRecord, VidDownloads } from "./VidDownloads";
import { TxRecord } from "shepherd-plugin-interfaces/types";
import { slackLogger } from "../../utils/slackLogger";
import si from 'systeminformation'
import { S3, AWSError } from "aws-sdk";

const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.SQS_LOCAL==='yes' && { 
		endpoint: process.env.S3_LOCAL_ENDPOINT!, 
		region: 'dummy-value',
		s3ForcePathStyle: true, // *** needed with minio ***
	}),
	maxRetries: 10,
})

const HOST_URL = process.env.HOST_URL!
const AWS_INPUT_BUCKET = process.env.AWS_INPUT_BUCKET!

const downloads = VidDownloads.getInstance()

export const addToDownloads = async(vid: {txid: string; content_size: string, content_type: string, receiptHandle: string})=> {

	// convert to a new VidDownloadRecord
	let dl: VidDownloadRecord = Object.assign({	complete: 'FALSE', retried: false }, vid)
	downloads.push(dl)

	//ensure this is called async
	videoDownload( dl )
	.then( (res)=> {
		logger(dl.txid, 'finished downloading', res)
	}).catch(async e => {
		logger(dl.txid, `UNHANDLED error in ${videoDownload.name}`, e.name, e.message, e.code, e)
		slackLogger(dl.txid, `UNHANDLED error in ${videoDownload.name}`, e.name, e.message, e.code)
		logger(dl.txid, await si.fsSize())
		// throw e;
	})

	const mb = 1024*1024
	logger(vid.txid, vid.content_size, `downloading video ${(downloads.size()/mb).toFixed(1)}MB/${VID_TMPDIR_MAXSIZE/mb}MB`, `${downloads.length()} vids in process.`)
}

export const videoDownload = async(vid: VidDownloadRecord)=> {
	return new Promise(async(resolve, reject)=> {

		// const url = HOST_URL + '/' + vid.txid
		const folderpath = VID_TMPDIR + vid.txid + '/'
		fs.mkdirSync(folderpath, { recursive: true })
		const filewriter = fs.createWriteStream(folderpath + vid.txid, { encoding: 'binary' })
	
		// const source = axios.CancelToken.source()
		// let timer: NodeJS.Timeout | null = null
		
		try{
			
			// const { data, headers } = await axios.get(url, {
			// 	cancelToken: source.token,
			// 	responseType: 'stream',
			// })
			const request = s3.getObject({ Bucket: AWS_INPUT_BUCKET, Key: vid.txid })
			const stream = request.createReadStream() //.pipe(filewriter)

			// /* Video size might be incorrect */
			// const contentLength = BigInt(headers['content-length'])
			// if(BigInt(vid.content_size) !== contentLength){
			// 	logger(vid.txid, 'content-length. gql:', vid.content_size, typeof vid.content_size, 'header:', contentLength)
			// 	vid.content_size = contentLength.toString()
			// }

			// timer = setTimeout( ()=>{
			// 	source.cancel()
			// 	logger(vid.txid, `No data timeout ${NO_STREAM_TIMEOUT} ms exceeded`)
			// 	dbNoDataFound(vid.txid)
			// 	filewriter.end()
			// 	resolve('no data timeout')
			// }, NO_STREAM_TIMEOUT )
			
			// const stream: IncomingMessage = data
			
			let mimeNotFound = true
			let filehead = new Uint8Array(0)
			let filesizeDownloaded = 0

			const fileTypeGood = (res: FileTypeResult | undefined)=>{
				if(res === undefined){
					logger(vid.txid, 'no file-type found:', res)
					dbNoMimeType(vid.txid)
					vid.content_type = 'undefined'
					return false
				}else 
				if(res && !res.mime.startsWith('video/')){
					logger(vid.txid, 'invalid video file-type:', res.mime)
					dbWrongMimeType(vid.txid, res.mime)
					vid.content_type = res.mime
					return false
				}
				logger(vid.txid, 'detected mime:', res?.mime)
				return true
			}
			
			stream.on('data', async(chunk: Uint8Array)=>{
				// clearTimeout(timer!)
				/* check the file head for mimetype & abort download if necessary */
				if(mimeNotFound){
					if(filehead.length < 4100){
						filehead = Buffer.concat([filehead, chunk])
					} else {
						mimeNotFound = false
						const res = await filetype.fromBuffer(filehead)
						if(!fileTypeGood(res)){
							filesizeDownloaded = 0 //reset so no partial-seed detected
							vid.complete = 'ERROR'
							stream.emit('error', new Error('non-vid'))
							return;
						}
					}
				}
				filesizeDownloaded += chunk.length
				
				if(filewriter.writable) filewriter.write(chunk)
			})
	
			stream.on('end', async()=>{
				filewriter.end()

				if(mimeNotFound){
					mimeNotFound = false
					const res = await filetype.fromBuffer(filehead)
					logger(vid.txid, 'mime was not found during download:', res)
					if(!fileTypeGood(res)){
						vid.complete = 'ERROR'
					}else{ 
						vid.complete = 'TRUE'
					}
				}else if(vid.complete !== 'ERROR'){ //tiny bad files can get here
					vid.complete = 'TRUE'
				}
				vid.complete === 'TRUE' ? resolve(true) : resolve(false)
			})
			
			stream.on('error', (e: AWSError)=>{
				if(process.env.NODE_ENV!=='test'){
					logger(`** DEBUG **:${videoDownload.name}`, JSON.stringify(e), JSON.stringify(vid))
				}
				if( [ 'TimeoutError', ...network_EXXX_codes ].includes(e.code) ){
					logger(vid.txid, `WARNING! ${e.name}(${e.code}):${e.message}`, e)
					// slackLogger(vid.txid, `WARNING! ${e.name}(${e.code}):${e.message}`, e)
					return;
				}
				if(vid.complete === 'TRUE') return;
				/* end streams */
				request.abort()
				filewriter.end()
				if(e.message === 'aborted'){
					logger(vid.txid, 'Error: aborted')
					if(filesizeDownloaded > 0 && !mimeNotFound && vid.content_type.startsWith('video/')){ 
						logger(vid.txid, 'partial-seed video found')
						slackLogger(vid.txid, `CHECK THIS! being marked as partial-seed`)
						dbPartialVideoFound(vid.txid) 
						vid.complete = 'TRUE'
						resolve(true)
					}else{
						vid.complete = 'ERROR'
						resolve('aborted')
					}
				}else if(e.message === 'non-vid'){
					logger(vid.txid, `Error: non-vid`)
					vid.complete = 'ERROR'
					resolve(false)
				}else{
					vid.complete = 'ERROR'
					logger(vid.txid,`potentially improperly unhandled rejection`, `${e.name}:${e.message}`, {vid, e})
					slackLogger(vid.txid,`potentially improperly unhandled rejection`, `${e.name}:${e.message}`, {vid, e})
					reject(e)
				}
			})

			stream.on('close', ()=>{
				filewriter.close()
			})
			
		}catch(e:any){
			// if(timer){
			// 	clearTimeout(timer)
			// }
			vid.complete = 'ERROR'
			filewriter.end()

			const code = e.response?.code || e.code || 'no-code'

			logger(vid.txid, 'UNHANDLED ERROR in videoDownload', e.name, ':', code, ':', e.message)
			logger(vid.txid, 'Full error e:', e)
			if(e.response){ logger(vid.txid, 'Full error e.response:', e.response) }
			slackLogger(vid.txid, 'UNHANDLED ERROR in videoDownload', e.name, ':', code, ':', e.message)
			logger(vid.txid, await si.mem())
			reject(e)
		}
	})//end Promise
}
