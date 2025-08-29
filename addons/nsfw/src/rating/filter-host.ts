import {
	corruptDataConfirmed, corruptDataMaybe, oversizedPngFound, partialImageFound, unsupportedMimeType, wrongMimeType, updateTx
} from '../utils/update-txs'
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

	try{

		const pic = (await s3.getObject({ Key: txid, Bucket: AWS_INPUT_BUCKET }).promise()).Body as Buffer

		const mime = await getImageMime(pic)
		if(mime === undefined){
			if(contentType.startsWith('image/')){
				logger(prefix, 'image mime-type found to be `undefined`. try rating anyway. Original:', contentType, txid)
			}else{
				const typeUpdated = contentType.startsWith('video') ? contentType : `video/${contentType}` //force to ffmpeg
				logger(prefix, `image mime-type found to be '${mime}'. will be automatically requeued using:`, typeUpdated, txid)
				await wrongMimeType(txid, typeUpdated) //shouldn't get here..
				return true
			}
		}else if(!mime.startsWith('image/')){
			logger(prefix, `image mime-type found to be '${mime}'. updating record; will be automatically requeued. Original:`, contentType, txid)
			await wrongMimeType(txid, mime)
			return true
		}else if(mime !== contentType){
			logger(prefix, `warning. expected '${contentType}' !== detected '${mime}'`, txid)
		}

		await checkImagePluginResults(pic, mime || contentType, txid)

		return true
	}catch(err:unknown){
		const e = err as Error

		if(e.message === 'End-Of-Stream'){
			logger(prefix, 'End-Of-Stream', contentType, txid)
			await corruptDataConfirmed(txid)
			return true
		}

		if(['RequestTimeTooSkewed', 'NoSuchKey'].includes(e.name)){
			throw e //bubble up to `harness` handler
		}

		logger(prefix, 'UNHANDLED Error processing', txid + ' ', e.name, ':', e.message)
		await slackLogger(prefix, 'UNHANDLED Error processing', txid, e.name, ':', e.message)
		logger(prefix, 'UNHANDLED', txid, e)
		logger(prefix, await si.mem())

		return false
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
		/* hack, remove specific spam false positives */
		if(
			result.flagged === true
			&& result.top_score_name === 'Porn'
			&& [0.903248131275177, 0.9651741981506348].includes(Number(result.top_score_value))
		){
			logger(txid, 'hack, removing specific spam false positive', JSON.stringify(result))
			await slackLogger(txid, 'hack, removing specific spam false positive', JSON.stringify(result))
			result.top_score_name = undefined
			result.top_score_value = undefined
			result.flagged = false
		}

		await updateTx(txid, {
			flagged: result.flagged,
			...( result.top_score_name && {
				top_score_name: result.top_score_name,
				top_score_value: result.top_score_value
			}),
		})
	}else{
		switch (result.data_reason){
		case 'corrupt-maybe':
			await corruptDataMaybe(txid)
			break
		case 'corrupt':
			await corruptDataConfirmed(txid)
			break
		case 'oversized':
			await oversizedPngFound(txid)
			break
		case 'partial':
			await partialImageFound(txid)
			break
		case 'unsupported':
			await unsupportedMimeType(txid)
			break
		case 'mimetype':
			await wrongMimeType(txid, result.err_message!)
			break

		default:
			logger(prefix, 'UNHANDLED FilterResult', txid)
			slackLogger(prefix, 'UNHANDLED FilterResult:\n' + JSON.stringify(result))
		}
	}
}



