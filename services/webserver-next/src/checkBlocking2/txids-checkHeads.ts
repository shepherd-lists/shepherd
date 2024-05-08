import { getBlockedTxids } from "./txids-cached"
import http2, { ClientHttp2Session } from 'http2'
import { Semaphore } from 'await-semaphore'
import { filterPendingOnly } from "./pending-promises"
import { performance } from 'perf_hooks'
import { slackLog } from "../../../../libs/utils/slackLog"
import { checkReachable } from "./txids-checkReachable"
import { setUnreachable } from "../checkBlocking/event-tracking"

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const maxConcurrentRequests = 150 //adjust this
const requestTimeout = 10_000 //ms. this too
const semaphore = new Semaphore(maxConcurrentRequests)

interface HeadRequestReturn {
	status: number
	'x-trace': string
	age?: string
}
const headRequest = async (session: ClientHttp2Session, txid: string, reqId: number) => {
	const release = await semaphore.acquire()

	return new Promise<HeadRequestReturn>((resolve, reject) => {
		if (session.destroyed) reject(Error('session already destroyed'))

		const req = session.request({
			':path': `/raw/${txid}`,
			':method': 'HEAD',
		})
		req.setTimeout(requestTimeout, () => {
			/** fail quickly */
			req.destroy(Error('timeout'))
			session.destroy(Error('timeout'))
			reject(Error('timedout'))
		})


		req.on('response', (headers, flags) => {
			resolve({
				status: +headers[':status']!,
				'x-trace': headers['x-trace'] as string,
				age: headers['age'],
			})
			// req.destroy() unnecessary and possibly harmful in a head req.
		})


		req.on('error', (e: NodeJS.ErrnoException) => {
			const { name, code, message, cause } = e
			/** N.B. slackLog does not work here! trust me. */
			console.error(headRequest.name, JSON.stringify({ name, code, message, reqId, txid, cause, causeCode: (cause as { code: string })?.code }))

			const causeCode = (e.cause as NodeJS.ErrnoException)?.code || ''
			if (['ECONNRESET', 'ETIMEDOUT'].includes(causeCode)) {
				session.destroy(new Error(causeCode)) //fail quickly, assume unreachable, will be retried anyhow
			}
			reject(e)
		})

		req.end()
	}).finally(() => release())
}

const handler = async (session: ClientHttp2Session, gw_url: string, txid: string, reqId: number) => {
	try {
		const status = await headRequest(session, txid, reqId)
		if (status.status !== 404) {
			//TODO: set alarm
		} else {
			//TODO: unset alarm
		}
		//TODO: unset unreachable
	} catch (e) {
		const { message, code } = e as NodeJS.ErrnoException
		console.error('caught error in handler', gw_url, txid, reqId, `code: ${code}, message: ${message}`)
		throw e
	}
}

export const checkServerBlockingTxids = async (gw_url: string, key: ('txidflagged.txt' | 'txidowners.txt')) => {
	//sanity
	if (!gw_url.startsWith('https://')) throw new Error(`invalid format. gw_url must start with https:// => ${gw_url}`)

	if (!await checkReachable(gw_url)) {
		setUnreachable({ name: gw_url, server: gw_url })
		console.info(checkServerBlockingTxids.name, gw_url, 'unreachable')
		return;
	}

	const blockedTxids = await getBlockedTxids(key)
	const session = http2.connect(gw_url, {
		rejectUnauthorized: false,
	}) //gw specific session

	/** debug */
	session.on('error', () => console.error(gw_url, 'session error'))
	session.on('close', () => console.info(gw_url, 'session close'))
	session.on('timeout', () => console.info(gw_url, 'session timeout'))

	const t0 = performance.now() // strang behaviour: t0 initialized on all sessions, and all await error on any single other session
	let promises: Promise<void>[] = []
	let count = 0
	try {
		for (const txid of blockedTxids) {
			promises.push(handler(session, gw_url, txid, count))

			if (promises.length > maxConcurrentRequests) {
				//let at least one resolve
				await Promise.race(promises)
				//remove resolved
				promises = await filterPendingOnly(promises)

				//TODO: retry rejected
			}
			if (++count % 1_000 === 0) console.log(
				checkServerBlockingTxids.name, gw_url, key, `${count} items dispatched in ${(performance.now() - t0).toFixed(0)}ms`,
				'outboundQueueSize', session.state.outboundQueueSize
			)
		}
		await Promise.all(promises)

		console.info(checkServerBlockingTxids.name, gw_url, key, `completed ${count} checks in ${(performance.now() - t0).toFixed(0)}ms`)
	} catch (err: unknown) {
		const { message, code, cause } = err as NodeJS.ErrnoException
		console.error('outer catch', JSON.stringify({ message, code, cause }))
		if (message === 'timedout') {
			setUnreachable({ name: gw_url, server: gw_url })
		}
	} finally {
		session.close()
	}
}

// checkServerBlockingTxids('https://arweave.net', 'txidowners.txt')
// checkServerBlockingTxids('https://arweave.dev', 'txidowners.txt')
// checkServerBlockingTxids('https://18.133.224.136', 'txidflagged.txt')
// checkServerBlockingTxids('https://arweave.net', 'txidowners.txt')
// checkServerBlockingTxids('https://localhost', 'txidowners.txt')

