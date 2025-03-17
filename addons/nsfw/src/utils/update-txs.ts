import { APIFilterResult, FilterErrorResult, FilterResult } from 'shepherd-plugin-interfaces'
import { logger } from './logger'
import { slackLogger } from './slackLogger'

import axios from 'axios'

// /** this improves things slightly with Fetch */
// import http from 'http'
// http.globalAgent.maxSockets = 1_000

let count = 0
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

if(!process.env.HTTP_API_URL) throw new Error('HTTP_API_URL not defined')
const HTTP_API_URL = process.env.HTTP_API_URL
console.log('HTTP_API_URL', HTTP_API_URL)

export const updateTx = async(txid: string, filterResult: Partial<FilterResult | FilterErrorResult> )=> {
	const _count = ++count
	try{
		const payload: APIFilterResult = {
			txid,
			filterResult: filterResult as FilterResult,
		}
		const payloadString = JSON.stringify(payload)

		console.log(txid, `sending ${_count} ...`, )
		let tries=3
		while(true){
			--tries
			try{
				const res = await axios.post(HTTP_API_URL, payloadString, {
					headers: {
						'Content-Type': 'application/json; charset=UTF-8',
					},
				})
				console.log(txid, `sent ${_count}`, res.status, res.statusText)
				break
			}catch(err0:unknown){
				const e0 = err0 as Error
				if(tries>=0){
					console.error(txid, 'error posting to http-api',e0.name, ':', e0.message, 'retrying...')
					await sleep(2_000)
					continue
				}else{
					throw err0
				}
			}
		}


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


		return txid

	}catch(err:unknown){
		const e = err as Error
		logger(txid, 'Error posting to http-api', e.name, ':', e.message, JSON.stringify(filterResult), e)
		slackLogger(txid, ':warning: Error posting to http-api (nsfw) after 3 tries', e.name, ':', e.message, JSON.stringify(filterResult))
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
		//@ts-expect-error data_reason doesn't include 'partial-seed'
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
