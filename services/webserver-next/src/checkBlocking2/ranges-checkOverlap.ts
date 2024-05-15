import { alertStateCronjob, setAlertState, setUnreachable, unreachableTimedout } from '../checkBlocking/event-tracking'
import { RangelistAllowedItem } from '../webserver-types'
import { ByteRange, RangeKey, getBlockedRanges } from './ranges-cachedBlocked'
import { dataSyncObjectStream } from './ranges-dataSyncRecord'
import { performance } from 'perf_hooks'
import { checkReachable } from './txids-checkReachable'



/**
 * function to test if 2 ranges overlap. note: erlang strangeness, add +1 to start
 * @param rangeA of form [start+1, end]
 * @param rangeB of form [start+1, end]
 * @returns boolean indicating ranges overlap
 */
const rangesOverlap = (rangeA: [number, number], rangeB: [number, number]) => {
	return (rangeA[0] <= rangeB[1] && rangeB[0] <= rangeA[1])
}

export const checkServerBlockingChunks = async (item: RangelistAllowedItem, key: RangeKey = 'rangelist.txt') => {
	/** check if server reachable */
	if (!unreachableTimedout(item.name)) {
		console.info(`${item.name} is in unreachable timeout`)
		return;
	}
	if (!await checkReachable(`http://${item.server}:1984/info`)) {
		setUnreachable(item)
		console.info(checkServerBlockingChunks.name, item.name, 'set unreachable')
		return;
	}

	// get data_sync_records from server
	const dsrStream = await dataSyncObjectStream(item.server, 1984)

	// ensure blocked ranges are up to date and loaded
	const blockedRanges = await getBlockedRanges(key)

	/** N.B. the data from Erlang is all backwards. arrays start at end, end at start+1, etc. fix this on the fly. */
	// let last = { start: Infinity, end: Infinity }
	let count = 0
	const t0 = performance.now()
	let tMatch = 0
	let numNotBlocked = 0
	for await (const dsr of dsrStream) {
		count++
		//extract start and end from the single key-value pair
		const end = +Object.keys(dsr)[0]
		const startString = dsr[end]
		const start = +startString
		//sanity
		if (start > end) {
			throw new Error(`${item.name} start > end`)
		}
		// //check current is less than last (backwards erlang ordering)
		// if (start > last.start || end > last.start) {
		// 	throw new Error(`out of order/overlap, this=start:${start},end:${end}, last=${JSON.stringify(last)}`)
		// }
		// last = { start, end }

		const m0 = performance.now()

		//check if part of this data_sync_record should be blocked
		blockedRanges.find(blockedRange => {
			//allow for some Erlang weirdness by adding 1 to the starts
			const notblocked = rangesOverlap([start + 1, end], [blockedRange[0], blockedRange[1]])
			if (notblocked) {

				process.nextTick(() => doubleCheck(blockedRange, item))
				console.info(`${item.name} range not blocked.`, JSON.stringify({ blockedRange, start, end }))

				numNotBlocked++
				console.info(`aborting remaining checks on ${item.name}`)
				dsrStream.return() //exit checking the rest of the stream

				/* raise an alarm */
				setAlertState({
					server: item,
					item: startString,
					status: 'alarm',
				})
				return true;
			}
			setAlertState({ server: item, item: startString, status: 'ok' }) // 92% speed increase when this is removed!
		})
		tMatch += performance.now() - m0
	}
	console.info(item.name, `checked ${count} dataSyncRecords (${numNotBlocked} not blocked) for overlap in ${(performance.now() - t0).toFixed(0)}ms. matching time ${tMatch.toFixed(0)}ms`)
}

const doubleCheck = async (range: ByteRange, item: RangelistAllowedItem) => {

	const startChunk = range[0].toString()
	const endChunk = range[1].toString()

	await new Promise(resolve => setTimeout(resolve, 1)) // issue with connection failing after long wait

	const getStatus = async (url: string) => fetch(url).then(res => console.info(item.name, url, res.status))

	const startUrl = `http://${item.server}:1984/chunk/${startChunk}`
	const endUrl = `http://${item.server}:1984/chunk/${endChunk}`

	await Promise.all([getStatus(startUrl), getStatus(endUrl)])

}
