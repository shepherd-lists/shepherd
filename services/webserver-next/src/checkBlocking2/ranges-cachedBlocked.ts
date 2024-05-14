import { s3GetObjectWebStream, s3HeadObject } from "../../../../libs/utils/s3-services"
import { slackLog } from "../../../../libs/utils/slackLog"
import { performance } from 'perf_hooks'
import { readlineWeb } from "../../../../libs/utils/webstream-utils"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


type ByteRange = [number, number]

interface RangeCache {
	eTag: string
	ranges: Array<ByteRange>
	inProgress: boolean
}
const _rangeCache: RangeCache = { eTag: '', ranges: [], inProgress: false }

export const getBlockedRanges = async (key: string = 'rangelist.txt') => {
	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, key)).ETag!
	console.debug(getBlockedRanges.name, 'eTag', eTag)

	/** short-circuit */
	if (eTag === _rangeCache.eTag) {
		console.info(getBlockedRanges.name, 'returning cache')
		return _rangeCache.ranges
	}

	/** just one running update is allowed/required */
	if (_rangeCache.inProgress) {
		console.info(getBlockedRanges.name, 'waiting for cache update as inProgress')
		while (_rangeCache.inProgress) {
			await sleep(100) //wait for new cache
		}
		console.info(getBlockedRanges.name, 'returning cache')
		return _rangeCache.ranges
	}
	_rangeCache.inProgress = true

	/** fetch rangelist.txt */

	console.info(getBlockedRanges.name, 'fetching & processing new cache...')
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
	console.info(getBlockedRanges.name, `fetched ${ranges.length} ranges in ${(t1 - t0).toFixed(0)}ms`)

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
	console.info(getBlockedRanges.name, `sorted & merged to ${mergedRanges.length} ranges in ${(t2 - t1).toFixed(0)}ms.`)

	// const mergedRangesPlusOne = mergedRanges.map(([start, end]) => [start + 1, end] as ByteRange)
	/** finish up */

	console.info(getBlockedRanges.name, `Total time: ${(t2 - t0).toFixed(0)}ms`)
	_rangeCache.inProgress = false
	return _rangeCache.ranges = mergedRanges //PlusOne
}
