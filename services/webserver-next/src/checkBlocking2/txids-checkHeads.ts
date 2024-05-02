import { getBlockedTxids } from "./txids-cached"
import http2, { ClientHttp2Session } from 'http2'
import { Semaphore } from 'await-semaphore'
import { filterPendingOnly } from "./pending-promises"
import { performance } from 'perf_hooks'


const maxConcurrentRequests = 200 //adjust this
const requestTimeout = 60_000 //ms. this too
const semaphore = new Semaphore(maxConcurrentRequests)

const headRequest = async (session: ClientHttp2Session, txid: string) => {
	const release = await semaphore.acquire()

	return new Promise<number>((resolve, reject) => {
		const req = session.request({
			':path': `/raw/${txid}`,
			':method': 'HEAD',
		})

		const reqTimeout = setTimeout(() => {
			req.destroy(new Error(`${headRequest.name} ${txid} 'request timeout'`)) //causes error event
		}, requestTimeout)

		req.on('response', (headers, flags) => {
			clearTimeout(reqTimeout)
			resolve(+headers[':status']!)
			req.destroy()
		})

		req.on('error', (err: Error & { code: string }) => reject(err))

		req.end()
	}).finally(() => release())
	//TODO: retry connection errors
}

const handler = async (session: ClientHttp2Session, txid: string) => {
	const status = await headRequest(session, txid)
	// console.info({ txid, status })

	//TODO: set alarms etc. this is a placeholder function
}

export const checkServerBlockingTxids = async (gw_url: string, key: ('txidflagged.txt' | 'txidowners.txt')) => {
	//sanity
	if (!gw_url.startsWith('https://')) throw new Error(`invalid format. gw_url must start with https:// => ${gw_url}`)

	const blockedTxids = await getBlockedTxids(key)
	const session = http2.connect(gw_url) //gw specific session

	// don't assume gateways are reachable

	const t0 = performance.now()
	let promises: Promise<void>[] = []
	let count = 0
	for (const txid of blockedTxids) {
		promises.push(handler(session, txid))

		if (promises.length > maxConcurrentRequests) {
			//let at least one resolve
			await Promise.race(promises)
			//remove resolved
			promises = await filterPendingOnly(promises)

			//TODO: retry rejected
		}
		if (++count % 1_000 === 0) console.log(checkServerBlockingTxids.name, key, `${count} items dispatched in ${(performance.now() - t0).toFixed(0)}ms`)
	}
	await Promise.all(promises)

	console.info(checkServerBlockingTxids.name, key, `completed checks in ${(performance.now() - t0).toFixed(0)}ms`)
	session.close()
}

// checkServerBlockingTxids('https://arweave.net', 'txidowners.txt')
