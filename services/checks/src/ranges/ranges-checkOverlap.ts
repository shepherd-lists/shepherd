import { ByteRange, getBlockedRanges } from './ranges-cachedBlocked'
import { performance } from 'perf_hooks'
import { checkReachable } from '../checkReachable'
import { unreachableTimedout, setUnreachable } from '../event-unreachable'
import { Http_Api_Node } from '../../../../libs/utils/update-range-nodes'
import { MessageType } from '..'
import { getServerAlarmsIPC } from './ranges-entrypoint'
import { FolderName } from '../types'



/**
 * function to test if 2 ranges overlap. note erlang strangeness: byte pointed to by start is not in the range
 * @returns boolean indicating ranges overlap
 */
const rangesOverlap = (rangeA: [number, number], rangeB: [number, number]) => {
	return (rangeA[0] < rangeB[1] && rangeB[0] < rangeA[1])
}

export const checkServerRanges = async (item: Http_Api_Node, listdir: FolderName = 'list/') => {
	/** check if server reachable */
	if (!unreachableTimedout(item.name)) {
		console.info(`${item.name} is in unreachable timeout`)
		return;
	}
	if (!await checkReachable(`http://${item.server}:1984/info`)) {
		setUnreachable(item)
		console.info(checkServerRanges.name, item.name, 'set unreachable')
		return;
	}
	// console.info(checkServerRanges.name, item.name || item.server, 'reachable')

	try {

		/* get data_sync_records from particular server */
		const res = await fetch(`http://${item.server}:1984/data_sync_record`, {
			headers: { 'Content-Type': 'application/json' },
		})
		if (!res.ok && res.headers.get('Content-Type') !== 'application/json') {
			throw new Error(`could not retrieve dsr. status:${res.status}, content-type:${res.headers.get('Content-Type')}`)
		}
		const dsrJson = await res.json()
		const serverRanges: ByteRange[] = []
		for (const dsr of dsrJson) {
			/** extract start and end from the single key-value pair from the crazy erlang node data. form: { [endValue: string]: string } */
			const end = +Object.keys(dsr)[0]
			const start = +dsr[end]
			serverRanges.push([start, end])
		}

		/** get blocked ranges */
		const blockedRanges = await getBlockedRanges(listdir)
		console.debug('DEBUG', `number of ranges ${((await blockedRanges!.getRanges()).length)}`)

		/* check existing alarms */
		console.info(checkServerRanges.name, item.name, 'begin check existing alarms...')
		// get current alert state - there *should* only be 1 alarm for these nodes
		const a0 = performance.now()
		const alarms = await getServerAlarmsIPC(item.server)
		console.info(checkServerRanges.name, item.name,
			`req-res IPC for ${Object.keys(alarms).length} alarms`,
			`in ${Math.floor(performance.now() - a0)}ms.`
		)

		let anyAlarm = false
		for (const line of Object.keys(alarms)) {
			/** check if any alarms "ok" now */
			const alarmRange = line.split(',').map(Number) as ByteRange

			/** check if we have a matching alarm already, or clear any set alarms */
			const alarm = serverRanges.some(serverRange => {
				const notblocked = rangesOverlap(alarmRange, serverRange)
				if (notblocked) {
					console.info(`${item.name} already in alarm ${line}. aborting remaining checks.`)
					return true
				}
			})
			if (!alarm) {
				/** clear alarm */
				console.info(checkServerRanges.name, item.name, '*** MARKING ALARM OK ***', line)

				/** send the new state back to the main thread */
				process.send!(<MessageType>{
					type: 'setState',
					newState: {
						server: item.server,
						serverName: item.name,
						serverType: 'node',
						details: {
							status: 'ok',
							line,
							endpointType: '/chunk',
						}
					},
				})
			}
			anyAlarm ||= alarm
		}//eo alarms lines

		if (anyAlarm) { //skip checking for more
			console.info(checkServerRanges.name, item.name, 'alarm already present. exiting.')
			return;
		}

		console.info(checkServerRanges.name, item.name, 'check for new alarms...')

		let count = 0
		const t0 = performance.now()
		let tMatch = 0
		let numNotBlocked = 0
		for await (const [start, end] of serverRanges) {
			count++
			//sanity
			if (start > end) {
				throw new Error(`${item.name} start > end, ${start} > ${end}`)
			}

			const m0 = performance.now()

			/** check if part of this data_sync_record should be blocked */
			const newAlarm = (await blockedRanges!.getRanges()).some(blockedRange => {
				const notblocked = rangesOverlap([start, end], blockedRange)
				if (notblocked) {
					numNotBlocked++

					// process.nextTick(() => doubleCheck(blockedRange, item))
					console.info(checkServerRanges.name, `${item.name} range not blocked.`, JSON.stringify({ blockedRange, start, end }), 'aborting remaining checks.')

					/* send an alarm to the main thread */
					process.send!(<MessageType>{
						type: 'setState',
						newState: {
							serverName: item.name,
							server: item.server,
							serverType: 'node',
							details: {
								status: 'alarm',
								line: `${blockedRange[0]},${blockedRange[1]}`, //a string is easier as {txid} is just a string
								endpointType: '/chunk',
							}
						}
					})

					return true;
				}
			})
			tMatch += performance.now() - m0
			if (newAlarm) {
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 0)) //hack to break up the cpu hogging
		}
		console.info(checkServerRanges.name, item.name, `checked ${count} dataSyncRecords (${numNotBlocked} not blocked) for overlap in ${(performance.now() - t0).toFixed(0)}ms. matching time ${tMatch.toFixed(0)}ms`)

	} catch (e) {
		/** just set the node as unreachable this time around */
		setUnreachable(item)
		const { name, message } = e as Error
		console.info(checkServerRanges.name, item.name, 'SET UNREACHABLE DURING DSR PROCESSING', `${name}:${message}`)
		console.error(e)
	}
}

/** dont run these check outside of test */
const doubleCheck = async (range: ByteRange, item: Http_Api_Node) => {

	const startChunk = (range[0] + 1).toString()
	const endChunk = range[1].toString()

	await new Promise(resolve => setTimeout(resolve, 1)) // issue with connection failing after long wait

	const getStatus = async (url: string) => fetch(url).then(res => console.info(item.name, url, res.status))

	const startUrl = `http://${item.server}:1984/chunk/${startChunk}`
	const endUrl = `http://${item.server}:1984/chunk/${endChunk}`

	await Promise.all([getStatus(startUrl), getStatus(endUrl)])

}
