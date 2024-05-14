import { s3GetObjectWebStream, s3HeadObject } from "../../../../libs/utils/s3-services"
import { slackLog } from "../../../../libs/utils/slackLog"
import { performance } from 'perf_hooks'
import { readlineWeb } from "../../../../libs/utils/webstream-utils"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


export type ByteRange = [number, number]

export type RangeKey = 'rangelist.txt' | 'rangeflagged.txt' | 'rangeowners.txt'

interface RangeCache {
	eTag: string
	ranges: Array<ByteRange>
	inProgress: boolean
}
const _rangeCache: { [key: string]: RangeCache } = {}


export const getBlockedRanges = async (key: RangeKey): Promise<ByteRange[]> => {
	/** create entry */
	if (!_rangeCache[key]) _rangeCache[key] = { eTag: '', ranges: [], inProgress: false }

	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, key)).ETag!
	// console.debug(getBlockedRanges.name, key, 'eTag', eTag)

	/** handle concatenating lists for `rangelist.txt` request */
	if (key === 'rangelist.txt') {
		console.info(getBlockedRanges.name, key, 'concatenating lists...')
		return [...(await getBlockedRanges('rangeflagged.txt')), ...(await getBlockedRanges('rangeowners.txt'))]
	}

	/** short-circuit */
	if (eTag === _rangeCache[key].eTag) {
		console.info(getBlockedRanges.name, `returning ${key} cache`)
		return _rangeCache[key].ranges
	}

	/** just one running update is allowed/required */
	if (_rangeCache[key].inProgress) {
		console.info(getBlockedRanges.name, key, 'waiting for cache update as inProgress')
		while (_rangeCache[key].inProgress) {
			await sleep(100) //wait for new cache
		}
		console.info(getBlockedRanges.name, key, 'returning cache')
		return _rangeCache[key].ranges
	}
	_rangeCache[key].inProgress = true

	/** fetch rangelist.txt */

	console.info(getBlockedRanges.name, key, 'fetching & processing new cache...')
	const t0 = performance.now()

	const stream = await s3GetObjectWebStream(process.env.LISTS_BUCKET!, key)
	let ranges: Array<ByteRange> = []
	for await (const line of readlineWeb(stream)) {
		//DEBUG
		if (line.length === 0) {
			slackLog(getBlockedRanges.name, `WARNING! empty line retrieving ${key}`)
			continue;
		}
		const [start, end] = line.split(',').map(Number) as ByteRange
		ranges.push([start, end])
	}
	const t1 = performance.now()
	console.info(getBlockedRanges.name, key, `fetched ${ranges.length} ranges in ${(t1 - t0).toFixed(0)}ms`)

	/** merge contiguous ranges */

	const mergedRanges: ByteRange[] = []
	if (ranges.length > 0) {
		// Step 1: Sort the ranges by their start value
		ranges.sort((a, b) => a[0] - b[0])

		// Step 2: Initialize the first range as the current range to compare with others
		let currentRange = ranges[0]
		mergedRanges.push(currentRange)

		// Step 3: Iterate through the ranges, starting from the second range
		ranges.slice(1).forEach(range => {
			const [currentStart, currentEnd] = currentRange
			const [nextStart, nextEnd] = range

			// If the next range overlaps or is adjacent to the current range, merge them
			if (nextStart <= currentEnd + 1) {
				// Update the end of the current range in the mergedRanges array
				currentRange[1] = Math.max(currentEnd, nextEnd)
			} else {
				// If not overlapping or adjacent, move to the next range
				currentRange = range
				mergedRanges.push(currentRange)
			}
		})
	}
	const t2 = performance.now()
	console.info(getBlockedRanges.name, key, `sorted & merged to ${mergedRanges.length} ranges in ${(t2 - t1).toFixed(0)}ms.`)

	/** additional processing */
	// const mergedRangesPlusOne = mergedRanges.map(([start, end]) => [start + 1, end] as ByteRange)
	const t3 = performance.now()
	console.info(getBlockedRanges.name, key, `addtional processing done in ${(t3 - t2).toFixed(0)}ms`)

	/** finish up */

	console.info(getBlockedRanges.name, key, `Total caching time: ${(t2 - t0).toFixed(0)}ms`)
	_rangeCache[key].inProgress = false
	return _rangeCache[key].ranges = mergedRanges //PlusOne
}
