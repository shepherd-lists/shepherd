import { getBlockedRanges } from './ranges-cachedBlocked'
import { dataSyncObjectStream } from './ranges-dataSyncRecord'



/**
 * function to test if 2 ranges overlap. note: erlang strangeness, add +1 to start
 * @param rangeA of form [start+1, end]
 * @param rangeB of form [start+1, end]
 * @returns boolean indicating ranges overlap
 */
const rangesOverlap = (rangeA: [number, number], rangeB: [number, number]) => {
	return (rangeA[0] <= rangeB[1] && rangeB[0] <= rangeA[1])
}

export const checkServerBlockingChunks = async (domain: string, port: number) => {
	// get data_sync_records from server
	const dsrStream = await dataSyncObjectStream(domain, port)

	// ensure blocked ranges are up to date and loaded
	const blockedRanges = await getBlockedRanges()

	/** N.B. the data from Erlang is all backwards. arrays start at end, end at start+1, etc. fix this on the fly. */
	// let last = { start: Infinity, end: Infinity }
	let count = 0
	for await (const dsr of dsrStream) {
		count++
		//extract start and end from the single key-value pair
		const end = +Object.keys(dsr)[0]
		const start = +dsr[end]
		//sanity
		if (start > end) {
			throw new Error('start > end')
		}
		// //check current is less than last (backwards erlang ordering)
		// if (start > last.start || end > last.start) {
		// 	throw new Error(`out of order/overlap, this=start:${start},end:${end}, last=${JSON.stringify(last)}`)
		// }
		// last = { start, end }

		//check if part of this data_sync_record should be blocked
		const notblocked = blockedRanges.some(blockedRange => {
			//allow for some Erlang weirdness by adding 1 to the starts
			const notblocked = rangesOverlap([start + 1, end], [blockedRange[0] + 1, blockedRange[1]])
			if (notblocked) {
				console.info('range not blocked', { blockedRange, start, end })
				console.debug('start <= blockedRange[1]', start <= blockedRange[1])
				console.debug('end <= blockedRange[0]', end <= blockedRange[0])
				//TODO: raise an alert here
			}
			//TODO: short-circuit if range if dsr start > blockedRange.end 
			return notblocked
		})
		if (notblocked) console.info('range not-blocked', { notblocked, start, end })
		// else console.info('range clear', start, end)

	}
	console.info('total dataSyncRecords checked for overlap', count)

	//TODO: switch on and off alerts
	//TODO: switch on and off alerts
	//TODO: switch on and off alerts
}

