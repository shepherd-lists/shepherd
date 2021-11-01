import { logger } from '../utils/logger'
import { HOST_URL, NO_DATA_TIMEOUT } from '../constants'
import { axiosDataTimeout } from '../utils/axiosDataTimeout'
import { dbCorruptDataConfirmed, dbCorruptDataMaybe, dbNoDataFound404, dbNoMimeType, dbNoop, dbOversizedPngFound, dbPartialImageFound, dbTimeoutInBatch, dbUnsupportedMimeType, dbWrongMimeType, updateDb } from './db-update-txs'
import { getImageMime } from './image-filetype'
import loadConfig from '../utils/load-config'
import { slackLogger } from '../utils/slackLogger'


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
		let status = 0
		if(e.response && e.response.status){
			status = Number(e.response.status)
		}

		if(status === 404){
			logger(prefix, 'no data found (404)', contentType, url)
			await dbNoDataFound404(txid)
			return true;
		}
		
		else if(
			(e.message === `Timeout of ${NO_DATA_TIMEOUT}ms exceeded`)
			// || (!e.response && e.code && e.code === 'ECONNRESET')
		){
			logger(prefix, 'connection timed out in batch. check again alone', contentType, url)
			await dbTimeoutInBatch(txid)
		}
		
		else if(
			status >= 500
			|| ( e.code && ['ETIMEDOUT', 'ECONNRESET'].includes(e.code) )
		){
			// error in the gateway somewhere, not important to us
			logger(txid, e.message, 'image will automatically retry downloading') //do nothing, record remains in unprocessed queue
		}
		
		else{
			logger(prefix, 'UNHANDLED Error processing', url + ' ', status, ':', e.message)
			slackLogger(prefix, 'UNHANDLED Error processing', txid, status, ':', e.message)
			logger(prefix, 'UNHANDLED', e)
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

		//TODO: remove this NsfwjsPlugin specific code later
		let scores: {nsfw_hentai?: number, nsfw_porn?: number, nsfw_sexy?: number, nsfw_neutral?: number, nsfw_drawings?: number } = {}
		if(result.scores){
			let s = JSON.parse(result.scores)
			// convert what's there
			if(s['Drawing']) scores.nsfw_drawings = s['Drawing']
			if(s['Hentai']) scores.nsfw_hentai = s['Hentai']
			if(s['Neutral']) scores.nsfw_neutral = s['Neutral']
			if(s['Porn']) scores.nsfw_porn = s['Porn']
			if(s['Sexy']) scores.nsfw_sexy = s['Sexy']
		}

		await updateDb(txid, {
			flagged: result.flagged,
			valid_data: true,

			//TODO: replace this specific NsfwjsPlugin score data in the DB
			...(true && scores), //use some spread trickery to add non-null (or zero value) keys

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



