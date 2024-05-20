import { getBlockedTxids } from "./txids-cached"
import http2, { ClientHttp2Session } from 'http2'
import { Semaphore } from 'await-semaphore'
import { filterPendingOnly } from "./pending-promises"
import { performance } from 'perf_hooks'
import { slackLog } from "../../../../libs/utils/slackLog"
import { checkReachable } from "./txids-checkReachable"
import { existAlertState, existAlertStateLine, setAlertState, setUnreachable, unreachableTimedout } from "../checkBlocking/event-tracking"
import { slackLogPositive } from "../../../../libs/utils/slackLogPositive"

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const maxConcurrentRequests = 150 //adjust this
const requestTimeout = 30_000 //ms. this too
const semaphore = new Semaphore(maxConcurrentRequests)

interface HeadRequestReturn {
	status: number
	xtrace: string
	age?: string
	contentLength?: string
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
				xtrace: headers['x-trace'] as string,
				age: headers['age'],
				contentLength: headers['content-length'],
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
		const { status, age, xtrace, contentLength } = await headRequest(session, txid, reqId)

		if (status >= 500)
			return console.error(headRequest.name, `${gw_url} returned ${status} for ${txid}. ignoring..`)

		if (status !== 404) {
			setAlertState({
				server: gw_url,
				details: {
					status: 'alarm',
					line: txid,
					endpointType: '/TXID',
					xtrace,
					age,
					contentLength,
					httpStatus: status,
				},
			})

			// /* make sure Slack doesn't display link contents! */
			// slackLogPositive('warning', `[${checkServerBlockingTxids.name}] ${txid} not blocked on ${gw_url} (status: ${status}), xtrace: '${xtrace}', age: '${age}', content-length: '${contentLength}'`)

		} else {
			if (existAlertState(gw_url) && existAlertStateLine(gw_url, txid))
				setAlertState({
					server: gw_url,
					details: {
						status: 'ok',
						line: txid,
						endpointType: '/TXID',
					}
				})
		}
	} catch (e) {
		const { message, code } = e as NodeJS.ErrnoException
		console.error('caught error in handler', gw_url, txid, reqId, `code: ${code}, message: ${message}`)
		throw e
	}
}

export const checkServerBlockingTxids = async (gw_url: string, key: ('txidflagged.txt' | 'txidowners.txt')) => {
	//sanity
	if (!gw_url.startsWith('https://')) throw new Error(`invalid format. gw_url must start with https:// => ${gw_url}`)

	/** short-circuits */

	if (!unreachableTimedout(gw_url)) {
		console.info(checkServerBlockingTxids.name, gw_url, 'currently in unreachable timeout')
		return;
	}

	if (!await checkReachable(gw_url)) {
		setUnreachable({ name: gw_url, server: gw_url })
		console.info(checkServerBlockingTxids.name, gw_url, 'set unreachable')
		return;
	}

	/** fetch list and check thru it */

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
			console.info(checkServerBlockingTxids.name, gw_url, 'set unreachable mid-session')
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

