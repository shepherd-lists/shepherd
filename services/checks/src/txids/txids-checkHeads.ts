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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const maxConcurrentRequests = 150 //adjust this
const checksPerPeriod = 5_000 //adjust?
const avoidRatelimit = 30_000 //sorta same as above 
const requestTimeout = 45_000 //ms. this too
const semaphore = new Semaphore(maxConcurrentRequests)
const rejectTimedoutMsg = `timed-out ${requestTimeout}ms`

interface HeadRequestReturn {
	status: number
	xtrace: string
	age?: string
	contentLength?: string
	ageHeaders: { [key: string]: string }
}

const headRequest = async (domain: string, ids: TxidItem, reqId: number) => {
	const release = await semaphore.acquire()
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), requestTimeout)

	try {
		const response = await fetch(`https://${ids.base32}.${domain}/${ids.id}`, {
			method: 'HEAD',
			signal: controller.signal,
			headers: {
				'User-Agent': 'Shepherd/1.0',
			},
		})



		return {
			status: response.status,
			headers: response.headers,
		}
	} catch (error) {
		const { name, code, message, cause } = error as NodeJS.ErrnoException
		console.error(headRequest.name, JSON.stringify({
			name, code, message, reqId, txid: ids.id, cause,
			causeCode: (cause as { code: string })?.code
		}))
		throw error
	} finally {
		clearTimeout(timeoutId)
		release()
	}
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
		headers.forEach((value, key) => {
			if (key.includes('age')) {
				ageHeaders.push(`${key}=${value}`)
			} else if (key.includes('trace')) {
				traceHeaders.push(`${key}=${value}`)
			}
		})
		const arrayHeaders = Array.from(headers.entries())
		console.info(headRequest.name, `STATUS ${status}, ${gw_domain} ${ids.id}`, JSON.stringify({ headers: arrayHeaders }))

		if (status >= 500)
			throw new Error(`${headRequest.name}, ${gw_domain} returned ${status} for ${ids.id}. ignoring..`, { cause: { arrayHeaders } })

		if (status >= 400) {
			await slackLog(headRequest.name, 'ERROR!', JSON.stringify({ status, gw_domain, avoidRatelimit, headers: arrayHeaders }))
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
					contentLength: headers.get('content-length') || undefined,
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
		} while (blocked.length > 0)

		console.info(checkServerTxids.name, gw_domain, key, `completed ${countChecks} checks in ${Math.floor(performance.now() - t0)}ms`)
	} catch (e) {
		await slackLog(checkServerTxids.name, gw_domain, key, `UNHANDLED error ${(e as Error).message}`, e)
		throw e
	}
}

// setInterval(alertStateCronjob, 10_000)
checkServerTxids('arweave.net', 'flagged/')
// checkServerBlockingTxids('https://arweave.net', 'txidowners.txt')
// checkServerBlockingTxids('https://arweave.dev', 'txidowners.txt')
// checkServerBlockingTxids('https://18.1.1.1', 'txidflagged.txt')
// checkServerBlockingTxids('https://localhost', 'txidowners.txt')

