import { getBlockedTxids } from "./txids-cached"
import { Semaphore } from 'await-semaphore'
import { filterPendingOnly } from "../pending-promises"
import { performance } from 'perf_hooks'
import { checkReachable } from "../checkReachable"
import { getServerAlarms, setAlertState } from "../event-tracking"
import { setUnreachable, unreachableTimedout } from '../event-unreachable'
import { FolderName } from "../types"
import { slackLog } from "../../../../libs/utils/slackLog"
import { TxidItem } from '../../../../libs/s3-lists/ram-lists'
import { Agent, request } from 'https'



const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const maxConcurrentRequests = 100 //adjust this
const checksPerPeriod = 5_000 //adjust?
const avoidRatelimit = 30_000 //sorta same as above 
const requestTimeout = 45_000 //ms. this too
const semaphore = new Semaphore(maxConcurrentRequests)
const rejectTimedoutMsg = `timed-out ${requestTimeout}ms`

const agent = new Agent({
	keepAlive: true,
	// keepAliveMsecs: 1000,
	// timeout: 1000,	
	maxSockets: maxConcurrentRequests,
	maxFreeSockets: 10,
	timeout: requestTimeout,
})

const headRequest = async (domain: string, ids: TxidItem, reqId: number) => {
	const release = await semaphore.acquire()
	const url = `https://${ids.base32}.${domain}/${ids.id}`

	return new Promise<{ status: number, headers: any }>((resolve, reject) => {
		const req = request(
			url,
			{
				method: 'HEAD',
				agent,
				headers: {
					'User-Agent': 'Shepherd/1.0',
				},
				timeout: requestTimeout,
			},
			(res) => {
				// Consume response data to free up memory
				res.resume()
				res.on('end', () => {
					resolve({
						status: res.statusCode || 0,
						headers: res.headers,
					})
				})
			}
		)

		req.on('timeout', () => {
			req.destroy(new Error('Request timed out'))
		})
		req.on('error', (err) => {
			reject(err)
		})
		req.end()
	}).finally(() => {
		release()
	})
}

const newAlarmHandler = async (gw_domain: string, ids: TxidItem, reqId: number) => {
	try {
		const { status, headers } = await headRequest(gw_domain, ids, reqId)

		if (status === 404) {
			//this is what we want
			return;
		}

		// get age and trace headers
		const ageHeaders: string[] = []
		const traceHeaders: string[] = []
		Object.entries(headers).forEach(([key, value]) => {
			if (key.includes('age')) {
				ageHeaders.push(`${key}=${value}`)
			} else if (key.includes('trace')) {
				traceHeaders.push(`${key}=${value}`)
			}
		})
		console.info(headRequest.name, `STATUS ${status}, ${gw_domain} ${ids.id}`, JSON.stringify({ headers }))

		if (status >= 500)
			throw new Error(`${headRequest.name}, ${gw_domain} returned ${status} for ${ids.id}. ignoring..`, { cause: { headers } })

		if (status >= 400) {
			await slackLog(headRequest.name, 'ERROR!', JSON.stringify({ status, gw_domain, avoidRatelimit, headers }))
			throw new Error(`${headRequest.name}, ${gw_domain} returned 429 for ${ids.id}. ignoring..`, { cause: { status } })
		}

		if (status !== 404) {
			setAlertState({
				server: gw_domain,
				serverType: 'gw',
				details: {
					status: 'alarm',
					line: ids.id,
					base32: ids.base32,
					endpointType: '/TXID',
					xtrace: traceHeaders,
					age: ageHeaders,
					contentLength: headers['content-length'] || undefined,
					httpStatus: status,
				},
			})
		}
	} catch (e) {
		const { message, code } = e as NodeJS.ErrnoException
		console.error(`caught error in ${newAlarmHandler.name}`, gw_domain, ids.id, reqId, `code: ${code}, message: ${message}`)
		throw e
	}
}

const alarmOkHandler = async (gw_domain: string, ids: TxidItem, reqId: number) => {
	try {
		const { status } = await headRequest(gw_domain, ids, reqId)

		if (status === 404) {
			setAlertState({
				server: gw_domain,
				serverType: 'gw',
				details: {
					status: 'ok',
					line: ids.id,
					endpointType: '/TXID',
					httpStatus: 404,
				}
			})
			return false
		}
		return true
	} catch (e) {
		const { message, code } = e as NodeJS.ErrnoException
		console.error(`caught error in ${alarmOkHandler.name}`, gw_domain, ids.id, reqId, `code: ${code}, message: ${message}`)
		throw e
	}
}

let _sliceStart: { [key: string]: number } = {} // just keep going around even after errors
export const checkServerTxids = async (gw_domain: string, key: FolderName) => {
	//sanity
	if (gw_domain.startsWith('https://')) throw new Error(`invalid format. gw_domain cannot start with https:// => ${gw_domain}`)

	/** init */
	if (!_sliceStart[key]) _sliceStart[key] = 0

	/** short-circuits */
	if (!unreachableTimedout(gw_domain)) {
		console.info(checkServerTxids.name, gw_domain, key, 'currently in unreachable timeout')
		return;
	}

	if (!await checkReachable(`https://${gw_domain}`)) {
		setUnreachable({ name: gw_domain, server: gw_domain, url: `https://${gw_domain}` })
		console.info(checkServerTxids.name, gw_domain, key, 'set unreachable')
		return;
	}

	try {
		const blockedTxids = await getBlockedTxids(key)
		const t0 = performance.now()

		const debugTxids = blockedTxids!.getTxids()
		console.debug('DEBUG', `txids init ${key} ${debugTxids.length}`)

		let blocked = blockedTxids!.getTxids().slice(_sliceStart[key], checksPerPeriod)
		let countChecks = _sliceStart[key]
		do {
			const p0 = performance.now()
			try {
				/** check current alarms every time */
				const alarms = getServerAlarms(gw_domain)
				let countAlarms = 0
				const inAlarms = await Promise.all(Object.keys(alarms).map(async txid => {
					if (alarms[txid].status === 'alarm') {
						return alarmOkHandler(gw_domain, { id: txid, base32: alarms[txid].base32! }, countAlarms++)
					}
				}))
				const serverInAlarm = inAlarms.reduce((acc, cur) => acc || !!cur, false)

				console.info(checkServerTxids.name, gw_domain, key, `checked ${inAlarms.length} existing alarms, serverInAlarm=${serverInAlarm}`)

				if (serverInAlarm) {
					/** abort further checks */
					break;
				}

				/** check blocked */
				let promises: Promise<void>[] = []
				for (const ids of blocked) {
					promises.push(newAlarmHandler(gw_domain, ids, countChecks++))

					if (promises.length > maxConcurrentRequests) {
						//let at least one resolve
						await Promise.race(promises)
						//remove resolved
						promises = await filterPendingOnly(promises)
					}
					if (countChecks % 1_000 === 0) console.log(
						checkServerTxids.name, gw_domain, key, `${countChecks} items dispatched in ${(performance.now() - t0).toFixed(0)}ms`
					)
				}
				await Promise.all(promises)

			} catch (err: unknown) {
				const { message, code, cause } = err as NodeJS.ErrnoException
				console.error('outer catch', gw_domain, key, JSON.stringify({ message, code, cause }))
				if (message === rejectTimedoutMsg) {
					console.info(checkServerTxids.name, gw_domain, key, 'set unreachable mid-session')
					setUnreachable({ name: gw_domain, server: gw_domain })
				}
				break; //do-while
			}

			/* prepare for next run */
			_sliceStart[key] += checksPerPeriod

			const debugTxids = blockedTxids!.getTxids()
			console.debug('DEBUG', `txids slice ${key} ${debugTxids.length}`)

			blocked = blockedTxids!.getTxids().slice(_sliceStart[key], _sliceStart[key] + checksPerPeriod)

			if (blocked.length > 0) {
				const waitTime = Math.max(0, Math.floor(avoidRatelimit - (performance.now() - p0)))
				console.info(checkServerTxids.name, gw_domain, key, `pausing for ${waitTime}ms to avoid rate-limiting`)
				await sleep(waitTime)
			} else {
				console.info(checkServerTxids.name, gw_domain, key, `no more blocked slices ${blocked.length}`)
				_sliceStart[key] = 0 //reset
			}

			if (global.gc) {
				global.gc()
			}
		} while (blocked.length > 0)

		console.info(checkServerTxids.name, gw_domain, key, `completed ${countChecks} checks in ${Math.floor(performance.now() - t0)}ms`)
	} catch (e) {
		await slackLog(checkServerTxids.name, gw_domain, key, `UNHANDLED error ${(e as Error).message}`, e)
		throw e
	}
}

// setInterval(alertStateCronjob, 10_000)
// checkServerTxids('arweave.net', 'dnsr/')
// checkServerBlockingTxids('https://arweave.net', 'txidowners.txt')
// checkServerBlockingTxids('https://arweave.dev', 'txidowners.txt')
// checkServerBlockingTxids('https://18.1.1.1', 'txidflagged.txt')
// checkServerBlockingTxids('https://localhost', 'txidowners.txt')

