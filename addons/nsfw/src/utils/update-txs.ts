import { InflightsRecord, TxRecord } from 'shepherd-plugin-interfaces/types'
import { APIFilterResult, FilterErrorResult, FilterResult } from 'shepherd-plugin-interfaces'
import { logger } from './logger'
import { slackLogger } from './slackLogger'

if(!process.env.HTTP_API_URL) throw new Error('HTTP_API_URL not defined')
const HTTP_API_URL = process.env.HTTP_API_URL
console.log('HTTP_API_URL', HTTP_API_URL)

export const updateTx = async(txid: string, filterResult: Partial<FilterResult | FilterErrorResult> )=> {
	try{
		const payload: APIFilterResult = {
			txid,
			filterResult: filterResult as FilterResult,
		}
		const payloadString = JSON.stringify(payload)
		const { ok, status, statusText } = await fetch(HTTP_API_URL, {
			method: 'POST',
			body: payloadString,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': payloadString.length.toString(),
			},
		})
		if(!ok){
			logger(txid, `Error posting to http-api. ok:${ok}, status:${status}, statusText:${statusText}, filterResult:${JSON.stringify(filterResult)}`)
			slackLogger(txid, `Error posting to http-api. ok:${ok}, status:${status}, statusText:${statusText}, filterResult:${JSON.stringify(filterResult)}`)
		}

		return txid;

	}catch(e:any){
		logger(txid, 'Error posting to http-api', e.name, ':', e.message, JSON.stringify(filterResult))
		slackLogger(txid, 'Error posting to http-api (nsfw)', e.name, ':', e.message, JSON.stringify(filterResult))
		logger(txid, e) // `throw e` does nothing, use the return
	}
}

export const inflightDel = async(txid: string)=> {
	const res = await updateTx(txid,{
		data_reason: 'retry',
	})
	return res;
}

export const corruptDataConfirmed = async(txid: string)=> {
	const res = await updateTx(txid,{
		data_reason: 'corrupt',
	})
	return res;
}

export const corruptDataMaybe = async(txid: string)=> {
	const res = await updateTx(txid,{
		data_reason: 'corrupt-maybe',
	})
	return res;
}

export const partialImageFound = async(txid: string)=> {
	const res = await updateTx(txid,{
		data_reason: 'partial',
	})
	return res;
}

export const partialVideoFound = async(txid: string)=> {
	const res = await updateTx(txid,{
		data_reason: 'partial-seed', //check later if fully seeded
	})
	return res;
}

export const oversizedPngFound = async(txid: string)=> {
	const res = await updateTx(txid,{
		data_reason: 'oversized',
	})
	return res;
}

/** @deprecated */
export const wrongMimeType = async(txid: string, content_type: string)=> {
	const nonMedia = !content_type.startsWith('image') && !content_type.startsWith('video')
	const res = await updateTx(txid,{
		err_message: content_type,
		data_reason: 'mimetype',
	})
	return res;
}

export const unsupportedMimeType = async(txid: string)=> {
	const res = await updateTx(txid,{
		data_reason: 'unsupported',
	})
	return res;
}
