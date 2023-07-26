import { APIFilterResult, FilterErrorResult, FilterResult } from 'shepherd-plugin-interfaces'
import { logger } from './logger'
import { slackLogger } from './slackLogger'

import axios from 'axios'

// /** this improves things slightly with Fetch */
// import http from 'http'
// http.globalAgent.maxSockets = 1_000

let count = 0

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
		
		const res = await axios.post(HTTP_API_URL, payloadString, {
			headers: {
				'Content-Type': 'application/json; charset=UTF-8',
			},
		})
		console.log(txid, `sent ${++count}`, res.status, res.statusText)


		// const res = await fetch(HTTP_API_URL, {
		// 	method: 'POST',
		// 	body: payloadString,
		// 	headers: {
		// 		'Content-Type': 'application/json; charset=UTF-8',
		// 	},
		// 	keepalive: true,
		// })

		// /** use up the body and close connection */
		// if(!res.bodyUsed){
		// 	console.log({txid, res: await res.text(), resBodyUsed: res.bodyUsed})
		// 	res.body?.cancel() // doubly sure the connection is closed
		// }

		// if(!res.ok){
		// 	throw new Error(`ok:${res.ok}, status:${res.status}, statusText:${res.statusText}, bodyUsed:${res.bodyUsed}`)
		// }
		

		return txid;

	}catch(e:any){
		logger(txid, 'Error posting to http-api', e.name, ':', e.message, JSON.stringify(filterResult), JSON.stringify(e))
		slackLogger(txid, 'Error posting to http-api (nsfw)', e.name, ':', e.message, JSON.stringify(filterResult))
		logger(txid, e) // `throw e` does nothing, use the return
	}
}

export const inflightDel = async(txid: string)=> {
	return updateTx(txid,{
		data_reason: 'retry',
	})
}

export const corruptDataConfirmed = async(txid: string)=> {
	return updateTx(txid,{
		data_reason: 'corrupt',
	})
}

export const corruptDataMaybe = async(txid: string)=> {
	return updateTx(txid,{
		data_reason: 'corrupt-maybe',
	})
}

export const partialImageFound = async(txid: string)=> {
	return updateTx(txid,{
		data_reason: 'partial',
	})
}

export const partialVideoFound = async(txid: string)=> {
	return updateTx(txid,{
		data_reason: 'partial-seed', //check later if fully seeded
	})
}

export const oversizedPngFound = async(txid: string)=> {
	return updateTx(txid,{
		data_reason: 'oversized',
	})
}

/** @deprecated */
export const wrongMimeType = async(txid: string, content_type: string)=> {
	const nonMedia = !content_type.startsWith('image') && !content_type.startsWith('video')
	return updateTx(txid,{
		err_message: content_type,
		data_reason: 'mimetype',
	})
}

export const unsupportedMimeType = async(txid: string)=> {
	return updateTx(txid,{
		data_reason: 'unsupported',
	})
}
