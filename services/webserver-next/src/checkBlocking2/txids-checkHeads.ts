import { getBlockedTxids } from "./txids-cached"
import http2, { ClientHttp2Session } from 'http2'
import { Semaphore } from 'await-semaphore'
import { filterPendingOnly } from "./pending-promises"
import { performance } from 'perf_hooks'
import { slackLog } from "../../../../libs/utils/slackLog"

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const maxConcurrentRequests = 200 //adjust this
const requestTimeout = 60_000 //ms. this too
const semaphore = new Semaphore(maxConcurrentRequests)

interface HeadRequestReturn {
	status: number
	'x-trace': string
	age?: string
}
const headRequest = async (session: ClientHttp2Session, txid: string, reqId: number) => {
	const release = await semaphore.acquire()

	return new Promise<HeadRequestReturn>((resolve, reject) => {
		const req = session.request({
			':path': `/raw/${txid}`,
			':method': 'HEAD',
		})

		const reqTimeout = setTimeout(() => {
			req.destroy(new Error(`${headRequest.name} ${txid} 'request timeout'`)) //causes error event
		}, requestTimeout)



		req.on('response', (headers, flags) => {
			clearTimeout(reqTimeout)
			resolve({
				status: +headers[':status']!,
				'x-trace': headers['x-trace'] as string,
				age: headers['age'],
			})
			// req.destroy() unnecessary and possibly harmful in a head req.
		})


		req.on('error', (e: Error & { code: string }) => {
			const { name, code, message } = e
			/** N.B. slackLog does not work here! trust me. */
			console.error(headRequest.name, JSON.stringify({ name, code, message, reqId, txid }), e)
			// if (e.code === 'ERR_HTTP2_STREAM_ERROR' || e.message === 'Stream closed with error code NGHTTP2_REFUSED_STREAM') {
			reject(e)
		})

		req.end()
	}).finally(() => release())
	//TODO: retry connection errors
}

const handler = async (session: ClientHttp2Session, txid: string, reqId: number) => {
	const status = await headRequest(session, txid, reqId)
	// console.info({ txid, status })

	//TODO: set alarms etc. this is a placeholder function
}

export const checkServerBlockingTxids = async (gw_url: string, key: ('txidflagged.txt' | 'txidowners.txt')) => {
	//sanity
	if (!gw_url.startsWith('https://')) throw new Error(`invalid format. gw_url must start with https:// => ${gw_url}`)

	const blockedTxids = await getBlockedTxids(key)
	const session = http2.connect(gw_url) //gw specific session
	session.setTimeout(90_000, () => session.close())

	// don't assume gateways are reachable

	const t0 = performance.now()
	let promises: Promise<void>[] = []
	let count = 0
	for (const txid of blockedTxids) {
		promises.push(handler(session, txid, count))

		if (promises.length > maxConcurrentRequests) {
			//let at least one resolve
			await Promise.race(promises)
			//remove resolved
			promises = await filterPendingOnly(promises)

			//TODO: retry rejected
		}
		if (++count % 1_000 === 0) console.log(
			checkServerBlockingTxids.name, key, `${count} items dispatched in ${(performance.now() - t0).toFixed(0)}ms`,
			'outboundQueueSize', session.state.outboundQueueSize
		)
	}
	await Promise.all(promises)

	console.info(checkServerBlockingTxids.name, key, `completed checks in ${(performance.now() - t0).toFixed(0)}ms`)
	session.close()
}

// checkServerBlockingTxids('https://arweave.net', 'txidflagged.txt')
// checkServerBlockingTxids('https://arweave.net', 'txidowners.txt')

// checkServerBlockingTxids('https://<unreachable-server>', 'txidflagged.txt') // code: 'ERR_HTTP2_STREAM_CANCEL', cause.code: 'ECONNRESET' {"name":"Error","code":"ERR_HTTP2_STREAM_CANCEL","message":"The pending stream has been canceled (caused by: read ECONNRESET)"}
