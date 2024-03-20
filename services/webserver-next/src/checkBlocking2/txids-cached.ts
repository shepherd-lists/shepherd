import { s3GetObjectWebStream, s3HeadObject } from "../../../../libs/utils/s3-services"
import { slackLog } from "../../../../libs/utils/slackLog"
import { readlineWeb } from "../../../../libs/utils/webstream-utils"
import http2 from 'http2'
import { Semaphore } from 'await-semaphore'
import { filterPendingOnly } from "./pending-promises"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const HOST_URL = process.env.HOST_URL; console.info('HOST_URL', HOST_URL)
if (!HOST_URL) throw new Error('HOST_URL not set')

/** create some odd interfaces for smaller cache */
export interface IdSub {
	txid: string;
	subdomain: string
}
interface TxidCache {
	eTag: string
	idSubs: Array<IdSub>
	inProgress: boolean
}
const _txidCache: TxidCache = { eTag: '', idSubs: [], inProgress: false }



/** need to get and cache the redirect subdomains for these txids */

const session = http2.connect(`https://${HOST_URL}`)
const maxConcurrentRequests = 100 //adjust this
const semaphore = new Semaphore(maxConcurrentRequests)

const preRequestRedirectSub = async (txid: string) => {
	const release = await semaphore.acquire()

	return new Promise<IdSub>((resolve, reject) => {
		const req = session.request({
			':path': `/${txid}`,
			':method': 'HEAD',
		})

		const reqTimeout = setTimeout(() => {
			req.destroy(new Error(`${preRequestRedirectSub.name} ${txid} 'request timeout'`)) //causes error event
		}, 2000)

		req.on('response', (headers, flags) => {
			clearTimeout(reqTimeout)
			if (headers[':status'] === 302 && headers['location']) {
				console.debug('redirect', headers['location'])
				const subdomain = headers['location'].split('.')[0].split('//')[1]
				resolve({ txid, subdomain })
			} else {
				reject(headers[':status'])
			}
			req.destroy()
		})

		req.on('error', (err: Error & { code: string }) => reject(err))
		req.end()
	}).finally(() => release())
	//TODO: retry connection errors
}
// console.debug(await preRequestRedirectSub('aJ2AI_gNvKc_s9hrkIcoGEPHPP3oUQD48BGHp41TH3w'))
// console.debug(await preRequestRedirectSub('B4z-wUXRPMetJg9AfCtNcFRpv1lQ4VPpIvU-njhCt44'))


export const getBlockedTxids = async () => {
	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, 'blacklist.txt')).ETag!
	console.debug(getBlockedTxids.name, 'eTag', eTag)

	/** short-circuit */
	if (eTag === _txidCache.eTag) {
		console.info(getBlockedTxids.name, 'returning cache')
		return _txidCache.idSubs
	}

	/** just one running update is allowed/required */
	if (_txidCache.inProgress) {
		console.info(getBlockedTxids.name, 'waiting for cache update as inProgress')
		while (_txidCache.inProgress) {
			await sleep(100) //wait for new cache
		}
		console.info(getBlockedTxids.name, 'returning cache')
		return _txidCache.idSubs
	}
	_txidCache.inProgress = true

	/** fetch blacklist.txt */

	console.info(getBlockedTxids.name, 'fetching & processing new cache...')
	const t0 = performance.now()

	const stream = await s3GetObjectWebStream(process.env.LISTS_BUCKET!, 'blacklist.txt')
	const idSubs: Array<IdSub> = []
	let promises: Promise<IdSub>[] = []

	for await (const line of readlineWeb(stream)) {
		//debug/sanity check
		if (line.length === 0) {
			slackLog(getBlockedTxids.name, 'WARNING! empty line retrieving blacklist.txt')
			continue;
		}

		const promise = preRequestRedirectSub(line)
		promise.then(idSub => idSubs.push(idSub))

		promises.push(promise)

		if (promises.length >= maxConcurrentRequests) {
			await Promise.race(promises) //let at least one resolve
			//remove settled promises
			promises = await filterPendingOnly(promises) //TODO: retry rejected promises
		}
	}
	await Promise.all(promises)

	const t1 = performance.now()
	console.info(getBlockedTxids.name, `fetched ${idSubs.length} txids in ${(t1 - t0).toFixed(0)}ms`)

	_txidCache.idSubs = idSubs
	_txidCache.eTag = eTag
	_txidCache.inProgress = false
	console.info(getBlockedTxids.name, 'returning new cache')
	return idSubs
}

// getBlockedTxids()
// 	.then(() => console.info('done'))
// 	.catch(console.error)
// 	.finally(() => session.close())