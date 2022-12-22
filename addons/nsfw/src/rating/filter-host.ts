import { 
	dbCorruptDataConfirmed, dbCorruptDataMaybe, dbNoMimeType, dbOversizedPngFound, dbPartialImageFound, dbUnsupportedMimeType, dbWrongMimeType, updateTxsDb, dbInflightDel 
} from '../utils/db-update-txs'
import { getImageMime } from './image-filetype'
import { logger } from '../utils/logger'
import { slackLogger } from '../utils/slackLogger'
import loadConfig from '../utils/load-config'
import si from 'systeminformation'
import { s3, AWS_INPUT_BUCKET } from '../utils/aws-services'

const prefix = 'filter-host'

const HOST_URL = process.env.HOST_URL!


export const checkImageTxid = async(txid: string, contentType: string)=> {

	/* handle all downloading & mimetype problems before sending to FilterPlugins */

	// const url = `${HOST_URL}/${txid}`
	
	try {

		const pic = (await s3.getObject({ Key: txid, Bucket: AWS_INPUT_BUCKET }).promise()).Body as Buffer

		const mime = await getImageMime(pic)
		if(mime === undefined){
			if(contentType.startsWith('image/')){
				logger(prefix, 'image mime-type found to be `undefined`. try rating anyway. Original:', contentType, txid)
			}else{
				logger(prefix, `image mime-type found to be '${mime}'. will be automatically requeued using:`, contentType, txid)
				await dbWrongMimeType(txid, contentType) //shouldn't get here..
				return true;
			}
		}else if(!mime.startsWith('image/')){
			logger(prefix, `image mime-type found to be '${mime}'. updating record; will be automatically requeued. Original:`, contentType, txid)
			await dbWrongMimeType(txid, mime)
			return true
		}else if(mime !== contentType){
			logger(prefix, `warning. expected '${contentType}' !== detected '${mime}'`, txid)
		}

		await checkImagePluginResults(pic, mime || contentType, txid)

		return true;
	} catch(e:any) {

		if(e.message === 'End-Of-Stream'){
			logger(prefix, `End-Of-Stream`, contentType, txid)
			await dbCorruptDataConfirmed(txid)
			return true;
		}

		if(e.name === 'RequestTimeTooSkewed'){
			throw e; //bubble up to `harness` handler
		}

		logger(prefix, 'UNHANDLED Error processing', txid + ' ', e.name, ':', e.message)
		await slackLogger(prefix, 'UNHANDLED Error processing', txid, e.name, ':', e.message)
		logger(prefix, 'UNHANDLED', e)
		logger(prefix, await si.mem())

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
		await updateTxsDb(txid, {
			flagged: result.flagged,
			valid_data: true,
			...( result.top_score_name && { 
				top_score_name: result.top_score_name, 
				top_score_value: result.top_score_value
			}),
			last_update_date: new Date(),
		})
		dbInflightDel(txid)
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
		
			default:
				logger(prefix, 'UNHANDLED FilterResult', txid)
				slackLogger(prefix, `UNHANDLED FilterResult:\n` + JSON.stringify(result))
		}
	}
}



