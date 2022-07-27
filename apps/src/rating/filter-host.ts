import { logger } from '../utils/logger'
import { HOST_URL, NO_DATA_TIMEOUT } from '../constants'
import { axiosDataTimeout } from '../utils/axiosDataTimeout'
import { dbCorruptDataConfirmed, dbCorruptDataMaybe, dbNoDataFound404, dbNoMimeType, dbNoop, dbOversizedPngFound, dbPartialImageFound, dbTimeoutInBatch, dbUnsupportedMimeType, dbWrongMimeType, updateDb } from './db-update-txs'
import { getImageMime } from './image-filetype'
import loadConfig from '../utils/load-config'
import { slackLogger } from '../utils/slackLogger'
import si from 'systeminformation'


const prefix = 'filter-host'


export const checkImageTxid = async(txid: string, contentType: string)=> {

	/* handle all downloading & mimetype problems before sending to FilterPlugins */

	const url = `${HOST_URL}/${txid}`
	
	try {

		const pic = await axiosDataTimeout(url) //catch errors below

		const mime = await getImageMime(pic)
		if(mime === undefined){
			logger(prefix, 'image mime-type found to be `undefined`. omitting from rating. Original:', contentType, txid)
			await dbNoMimeType(txid)
			return true
		}else if(!mime.startsWith('image/')){
			logger(prefix, `image mime-type found to be '${mime}'. updating record; will be automatically requeued. Original:`, contentType, txid)
			await dbWrongMimeType(txid, mime)
			return true
		}else if(mime !== contentType){
			logger(prefix, `updating '${contentType}' to '${mime}' and resuming`, txid)
			await dbWrongMimeType(txid, mime)
		}

		await checkImagePluginResults(pic, mime, txid)

		return true;
	} catch(e:any) {

		/* catch network issues & no data situations */
		const status = Number(e.response?.status) || 0

		if(status === 404){
			logger(prefix, 'no data found (404)', contentType, url)
			await dbNoDataFound404(txid)
			return true;
		}
		
		else if(
			(e.message === `Timeout of ${NO_DATA_TIMEOUT}ms exceeded`)
		){
			logger(prefix, 'connection timed out in batch. check again alone', contentType, url)
			await dbTimeoutInBatch(txid)
		}
		
		else if(
			status >= 500
			|| ( e.code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND'].includes(e.code) )
		){
			// error in the gateway somewhere, not important to us
			logger(txid, e.message, 'image will automatically retry downloading') //do nothing, record remains in unprocessed queue
		}
		
		else{
			logger(prefix, 'UNHANDLED Error processing', url + ' ', status, ':', e.message)
			await slackLogger(prefix, 'UNHANDLED Error processing', txid, status, ':', e.message)
			logger(prefix, 'UNHANDLED', e)
			logger(prefix, await si.mem())
		}
		return false;
	}
}

export const checkImage = async(pic: Buffer, mime: string, txid: string)=>{
	/**
	 * for now we're just supporting a single loaded filter
	 */
	const config = await loadConfig() // this will be cached already
	return config.plugins[0].checkImage(pic, mime, txid)
}

const checkImagePluginResults = async(pic: Buffer, mime: string, txid: string)=>{

	const result = await checkImage(pic, mime, txid)

	if(result.flagged !== undefined){
		await updateDb(txid, {
			flagged: result.flagged,
			valid_data: true,
			last_update_date: new Date(),
		})
	}else{
		switch (result.data_reason) {
			case 'corrupt-maybe':
				await dbCorruptDataMaybe(txid)
				break;
			case 'corrupt':
				await dbCorruptDataConfirmed(txid)
				break;
			case 'oversized':
				await dbOversizedPngFound(txid)
				break;
			case 'partial':
				await dbPartialImageFound(txid)
				break;
			case 'unsupported':
				await dbUnsupportedMimeType(txid)
				break;
			case 'noop':
				// do nothing, but we need to take it out of the processing queue
				await dbNoop(txid)
				break;
		
			default:
				logger(prefix, 'UNHANDLED FilterResult', txid)
				slackLogger(prefix, `UNHANDLED FilterResult:\n` + JSON.stringify(result))
		}
	}
}



