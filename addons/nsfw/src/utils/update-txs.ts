import { APIFilterResult, FilterErrorResult, FilterResult } from 'shepherd-plugin-interfaces'
import { logger } from './logger'
import { slackLogger } from './slackLogger'
import { request, Agent } from 'node:http'
import { URL } from 'node:url'


// Configure global agent for connection pooling
const agent = new Agent({
	keepAlive: true,
	// keepAliveMsecs: 1000, //default 1000
	maxSockets: 100, // Limit concurrent connections
	maxFreeSockets: 10, // Keep some connections warm
	timeout: 130_000, // Socket timeout needs to be longer than connection timeout
})

// Monitor connection pool usage
setInterval(() => {
	const pool = agent.sockets[`${hostname}:${port}`] || []
	const free = agent.freeSockets[`${hostname}:${port}`] || []
	console.log(`Connection pool: ${pool.length} active, ${free.length} free, ${pool.length + free.length}/${agent.maxSockets} total`)
}, 30_000)

// /** this improves things slightly with Fetch */
// import http from 'http'
// http.globalAgent.maxSockets = 1_000

let count = 0
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

if(!process.env.HTTP_API_URL) throw new Error('HTTP_API_URL not defined')
const HTTP_API_URL = process.env.HTTP_API_URL
console.log('HTTP_API_URL', HTTP_API_URL)

// Parse the URL once
const url = new URL(HTTP_API_URL)
const hostname = url.hostname
const port = url.port
const path = url.pathname

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
				const result = await new Promise<{statusCode: number, statusMessage: string}>((resolve, reject) => {
					const req = request({
						hostname,
						port,
						path,
						method: 'POST',
						agent, // Use connection pooling
						headers: {
							'Content-Type': 'application/json; charset=UTF-8',
						},
						timeout: 120_000, // 2 minute timeout for slow processing
					}, (res) => {
						// Don't destroy the response - let it complete naturally
						let data = ''
						res.on('data', chunk => data += chunk) // Consume response body properly
						res.on('end', () => {
							resolve({
								statusCode: res.statusCode!,
								statusMessage: res.statusMessage!
							})
						})
						res.on('error', (err) => {
							// res.destroy()
							// req.destroy()
							// Don't destroy req here - it interferes with connection pooling
							reject(err)
						})
					})

					req.on('error', (err) => {
						// req.destroy() // don't destroy req here - it interferes with connection pooling
						reject(err)
					})

					req.on('timeout', () => {
						req.destroy()
						reject(new Error('Request timeout'))
					})

					req.write(payloadString)
					req.end()
				})

				console.info(txid, `sent ${_count}`, result.statusCode, result.statusMessage)
				break;
			}catch(err0:unknown){
				const e0 = err0 as Error
				if(tries>0){
					console.error(txid, 'error posting to http-api',e0.name, ':', e0.message, 'retrying...')
					await sleep(2_000)
					continue;
				}else{
					throw err0
				}
			}
		}



		return txid

	}catch(err:unknown){
		const e = err as Error
		logger(txid, 'Error posting to http-api', e.name, ':', e.message, JSON.stringify(filterResult), e)
		slackLogger(txid, ':warning: Error posting to http-api (nsfw) after 3 tries', e.name, ':', e.message, JSON.stringify(filterResult), e)
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
