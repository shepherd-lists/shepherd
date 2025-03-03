import { getBlockedTxids } from "./txids-cached"
import http2, { ClientHttp2Session } from 'http2'
import { Semaphore } from 'await-semaphore'
import { filterPendingOnly } from "../pending-promises"
import { performance } from 'perf_hooks'
import { checkReachable } from "../checkReachable"
import { getServerAlarms, setAlertState } from "../event-tracking"
import { setUnreachable, unreachableTimedout } from '../event-unreachable'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const maxConcurrentRequests = 150 //adjust this
const checksPerPeriod = 5_000 //adjust according to rate-limiting perceived
const requestTimeout = 30_000 //ms. this too
const semaphore = new Semaphore(maxConcurrentRequests)
const rejectTimedoutMsg = `timed-out ${requestTimeout}ms`

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
			req.destroy(Error(`timeout ${requestTimeout}ms`))
			session.destroy(Error(`timeout ${requestTimeout}ms`))
			reject(Error(rejectTimedoutMsg))
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

const newAlarmHandler = async (session: ClientHttp2Session, gw_url: string, txid: string, reqId: number) => {
	try {
		const { status, age, xtrace, contentLength } = await headRequest(session, txid, reqId)

		if (status >= 500)
			throw new Error(`${headRequest.name}, ${gw_url} returned ${status} for ${txid}. ignoring..`, { cause: { status } })

		if (status !== 404) {
			setAlertState({
				server: gw_url,
				serverType: 'gw',
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
		}
	} catch (e) {
		const { message, code } = e as NodeJS.ErrnoException
		console.error(`caught error in ${newAlarmHandler.name}`, gw_url, txid, reqId, `code: ${code}, message: ${message}`)
		throw e
	}
}

const alarmOkHandler = async (session: ClientHttp2Session, gw_url: string, txid: string, reqId: number) => {
	try {
		const { status, contentLength } = await headRequest(session, txid, reqId)

		if (status === 404) {
			setAlertState({
				server: gw_url,
				serverType: 'gw',
				details: {
					status: 'ok',
					line: txid,
					endpointType: '/TXID',
					httpStatus: 404,
					contentLength,
				}
			})
			return false
		}
		return true
	} catch (e) {
		const { message, code } = e as NodeJS.ErrnoException
		console.error(`caught error in ${alarmOkHandler.name}`, gw_url, txid, reqId, `code: ${code}, message: ${message}`)
		throw e
	}
}

let _sliceStart: { [key: string]: number } = {} // just keep going around even after errors
export const checkServerTxids = async (gw_url: string, key: ('txidflagged.txt' | 'txidowners.txt' | `${string}/txids.txt`)) => {
	//sanity
	if (!gw_url.startsWith('https://')) throw new Error(`invalid format. gw_url must start with https:// => ${gw_url}`)

	/** init */
	if (!_sliceStart[key]) _sliceStart[key] = 0

	/** short-circuits */

	if (!unreachableTimedout(gw_url)) {
		console.info(checkServerTxids.name, gw_url, key, 'currently in unreachable timeout')
		return;
	}

	if (!await checkReachable(gw_url)) {
		setUnreachable({ name: gw_url, server: gw_url })
		console.info(checkServerTxids.name, gw_url, key, 'set unreachable')
		return;
	}

	// plan:
	// do a set of checks every 30s (for example)
	// in that set check state for OKs and a slice of the blockedTxids
	// if any in-alarm exit the rest of checks

	const newSession = () => {
		const sesh = http2.connect(gw_url, {
			rejectUnauthorized: false,
		}) //gw specific session 
		/** debug */
		sesh.on('error', () => console.error(checkServerTxids.name, gw_url, key, 'session error'))
		sesh.on('close', () => console.info(checkServerTxids.name, gw_url, key, 'session close'))
		sesh.on('timeout', () => console.info(checkServerTxids.name, gw_url, key, 'session timeout'))
		return sesh;
	}

	const blockedTxids = await getBlockedTxids(key)
	const t0 = performance.now() // strang behaviour: t0 initialized on all sessions, and all await error on any single other session
	let blocked = blockedTxids.slice(_sliceStart[key], checksPerPeriod)
	let countChecks = _sliceStart[key]
	do {
		/** new session for each round */
		const session = newSession()
		const p0 = performance.now()
		try {
			/** check current alarms every time */
			const alarms = getServerAlarms(gw_url)
			let countAlarms = 0
			const inAlarms = await Promise.all(Object.keys(alarms).map(async txid => {
				if (alarms[txid].status === 'alarm') {
					return alarmOkHandler(session, gw_url, txid, countAlarms++)
				}
			}))
			const serverInAlarm = inAlarms.reduce((acc, cur) => acc || !!cur, false)

			console.info(checkServerTxids.name, gw_url, key, `checked ${inAlarms.length} existing alarms, serverInAlarm=${serverInAlarm}`)

			if (serverInAlarm) {
				/** abort further checks */
				break;
			}

			/** check blocked */

			let promises: Promise<void>[] = []
			for (const txid of blocked) {
				promises.push(newAlarmHandler(session, gw_url, txid, countChecks++))

				if (promises.length > maxConcurrentRequests) {
					//let at least one resolve
					await Promise.race(promises)
					//remove resolved
					promises = await filterPendingOnly(promises)

					//TODO: retry rejected
				}
				if (countChecks % 1_000 === 0) console.log(
					checkServerTxids.name, gw_url, key, `${countChecks} items dispatched in ${(performance.now() - t0).toFixed(0)}ms`,
					'outboundQueueSize', session.state.outboundQueueSize
				)
			}
			await Promise.all(promises)

		} catch (err: unknown) {
			const { message, code, cause } = err as NodeJS.ErrnoException
			console.error('outer catch', gw_url, key, JSON.stringify({ message, code, cause }))
			if (message === rejectTimedoutMsg) {
				console.info(checkServerTxids.name, gw_url, key, 'set unreachable mid-session')
				setUnreachable({ name: gw_url, server: gw_url })
			}
			break; //do-while
		} finally {
			session.close()
		}

		/* prepare for next run */
		_sliceStart[key] += checksPerPeriod
		blocked = blockedTxids.slice(_sliceStart[key], _sliceStart[key] + checksPerPeriod)

		if (blocked.length > 0) {
			const waitTime = Math.floor(30_000 - (performance.now() - p0))
			console.info(checkServerTxids.name, gw_url, key, `pausing for ${waitTime}ms to avoid rate-limiting`)
			await sleep(waitTime)
		} else {
			console.info(checkServerTxids.name, gw_url, key, `no more blocked slices ${blocked.length}`)
			_sliceStart[key] = 0 //reset
		}
	} while (blocked.length > 0)



	console.info(checkServerTxids.name, gw_url, key, `completed ${countChecks} checks in ${Math.floor(performance.now() - t0)}ms`)

}



// setInterval(alertStateCronjob, 10_000)
// checkServerBlockingTxids('https://arweave.net', 'txidflagged.txt')
// checkServerBlockingTxids('https://arweave.net', 'txidowners.txt')
// checkServerBlockingTxids('https://arweave.dev', 'txidowners.txt')
// checkServerBlockingTxids('https://18.1.1.1', 'txidflagged.txt')
// checkServerBlockingTxids('https://localhost', 'txidowners.txt')

