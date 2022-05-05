import axios from "axios";
import fs from 'fs'
import { exec } from 'child_process'
import filetype, { FileTypeResult } from "file-type";
import { IncomingMessage } from "http";
import { HOST_URL, NO_STREAM_TIMEOUT, VID_TMPDIR, VID_TMPDIR_MAXSIZE } from "../../common/constants";
import { logger } from "../../common/utils/logger";
import { dbNoDataFound, dbNoDataFound404, dbNoMimeType, dbPartialVideoFound, dbWrongMimeType } from "../../common/utils/db-update-txs";
import { VidDownloadRecord, VidDownloads } from "./VidDownloads";
import { TxRecord } from "../../common/types";
import { slackLogger } from "../../common/utils/slackLogger";
import si from 'systeminformation'


const downloads = VidDownloads.getInstance()

export const addToDownloads = async(vid: TxRecord)=> {

	// convert TxRecord to a new VidDownloadRecord
	let dl: VidDownloadRecord = Object.assign({	complete: 'FALSE', retried: false }, vid)
	downloads.push(dl)

	try{
		//call async as likely large download
		videoDownload( dl ).then( (res)=> {
			logger(dl.txid, 'finished downloading', res)
		})
	}catch(e:any){
		logger(dl.txid, e.message)
		throw e
	}

	const mb = 1024*1024
	logger(vid.txid, vid.content_size, `downloading video ${(downloads.size()/mb).toFixed(1)}MB/${VID_TMPDIR_MAXSIZE/mb}MB`, `${downloads.length()}/10`)
}

export const videoDownload = async(vid: VidDownloadRecord)=> {
	return new Promise(async(resolve, reject)=> {

		const url = HOST_URL + '/' + vid.txid
		const folderpath = VID_TMPDIR + vid.txid + '/'
		fs.mkdirSync(folderpath, { recursive: true })
		const filewriter = fs.createWriteStream(folderpath + vid.txid, { encoding: 'binary' })
	
		const source = axios.CancelToken.source()
		let timer: NodeJS.Timeout | null = null
		
		try{
			
			const { data, headers } = await axios.get(url, {
				cancelToken: source.token,
				responseType: 'stream',
			})

			/* Video size might be incorrect */
			const contentLength = BigInt(headers['content-length'])
			if(BigInt(vid.content_size) !== contentLength){
				logger(vid.txid, 'content-length. gql:', vid.content_size, typeof vid.content_size, 'header:', contentLength)
				vid.content_size = contentLength.toString()
			}

			timer = setTimeout( ()=>{
				source.cancel()
				logger(vid.txid, `No data timeout ${NO_STREAM_TIMEOUT} ms exceeded`)
				dbNoDataFound(vid.txid)
				filewriter.end()
				resolve('no data timeout')
			}, NO_STREAM_TIMEOUT )
			
			const stream: IncomingMessage = data
			
			let mimeNotFound = true
			let filehead = new Uint8Array(0)
			let filesizeDownloaded = 0

			const fileTypeGood = (res: FileTypeResult | undefined)=>{
				if(res === undefined){
					logger(vid.txid, 'no file-type found:', res)
					dbNoMimeType(vid.txid)
					vid.content_type = 'undefined'
					return false
				}else if(!res.mime.startsWith('video/')){
					logger(vid.txid, 'invalid video file-type:', res.mime)
					dbWrongMimeType(vid.txid, res.mime)
					vid.content_type = res.mime
					return false
				}
				logger(vid.txid, 'detected mime:', res.mime)
				return true
			}
			
			stream.on('data', async(chunk: Uint8Array)=>{
				clearTimeout(timer!)
				/* check the file head for mimetype & abort download if necessary */
				if(mimeNotFound){
					if(filehead.length < 4100){
						filehead = Buffer.concat([filehead, chunk])
					} else {
						mimeNotFound = false
						const res = await filetype.fromBuffer(filehead)
						if(!fileTypeGood(res)){
							source.cancel()
							filesizeDownloaded = 0 //reset so no partial-seed detected
							vid.complete = 'ERROR'
							return;
						}
					}
				}
				filesizeDownloaded += chunk.length
					
				filewriter.write(chunk)
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
	
			stream.on('error', (e: any)=>{
				if(process.env.NODE_ENV==='test'){
					logger('** DEBUG **:', JSON.stringify(e), JSON.stringify(vid))
				}
				filewriter.end()
				if(e.message && e.message === 'aborted'){
					logger(vid.txid, 'Error: aborted')
					if(filesizeDownloaded > 0 && !mimeNotFound && vid.content_type !== 'undefined'){ 
						logger(vid.txid, 'partial-seed video found')
						dbPartialVideoFound(vid.txid) 
						vid.complete = 'TRUE'
						resolve(true)
					}else{
						vid.complete = 'ERROR'
						resolve('aborted')
					}
				}else{
					vid.complete = 'ERROR'
					reject(JSON.stringify(e))
				}
			})

			stream.on('close', ()=>{
				filewriter.close()
			})
			
		}catch(e:any){
			if(timer){
				clearTimeout(timer)
			}
			vid.complete = 'ERROR'
			filewriter.end()

			const status = Number(e.response?.status) || 0
			const code = e.response?.code || e.code || 'no-code'

			if(status === 404){
				logger(vid.txid, 'Error 404 :', e.message)
				dbNoDataFound404(vid.txid)
				resolve(404)
			}else if(
				status >= 500
				|| e.message === 'Client network socket disconnected before secure TLS connection was established'
				|| ['ECONNRESET', 'ETIMEDOUT'].includes(code)
			){
				logger(vid.txid, e.message, 'Gateway error. Download will be retried')
				resolve('gateway error')
			}else{
				logger(vid.txid, 'UNHANDLED ERROR in videoDownload', e.name, ':', code, ':', status, ':', e.message)
				logger(vid.txid, 'Full error e:', e)
				if(e.response){ logger(vid.txid, 'Full error e.response:', e.response) }
				slackLogger(vid.txid, 'UNHANDLED ERROR in videoDownload', e.name, ':', code, ':', status, ':', e.message)
				logger(vid.txid, await si.mem())
				reject(e)
			}
		}
	})//end Promise
}
