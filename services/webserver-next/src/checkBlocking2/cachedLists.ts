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

export const blockedRanges = async () => {
	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, 'rangelist.txt')).ETag!
	console.debug(blockedRanges.name, 'eTag', eTag)

	/** short-circuit */
	if (eTag === _rangeCache.eTag) {
		console.info(blockedRanges.name, 'returning cache')
		return _rangeCache.ranges
	}

	/** overload check: just one update is allowed/required */
	if (_rangeCache.inProgress) {
		slackLog(blockedRanges.name, 'WARNING! waiting for cache update as inProgress. indicates server overloaded!')
		while (_rangeCache.inProgress) {
			await sleep(500) //wait for new cache
		}
		return _rangeCache.ranges
	}
	_rangeCache.inProgress = true

	/** fetch rangelist.txt */

	console.info(blockedRanges.name, 'fetching & processing new cache...')
	const t0 = performance.now()

	const stream = await s3GetObjectWebStream(process.env.LISTS_BUCKET!, 'rangelist.txt')
	let ranges: Array<ByteRange> = []
	for await (const line of readlineWeb(stream)) {
		//DEBUG
		if (line.length === 0) {
			slackLog(blockedRanges.name, 'WARNING! empty line retrieving rangelist.txt')
			continue;
		}
		const [start, end] = line.split(',').map(Number) as ByteRange
		ranges.push([start, end])
	}
	const t1 = performance.now()
	console.info(blockedRanges.name, `fetched ${ranges.length} ranges in ${(t1 - t0).toFixed(0)}ms`)

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
	console.info(blockedRanges.name, `merged ${mergedRanges.length} ranges in ${(t2 - t1).toFixed(0)}ms.`)

	/** finish up */

	console.info(blockedRanges.name, `Total time: ${(t2 - t0).toFixed(0)}ms`)
	_rangeCache.inProgress = false
	return _rangeCache.ranges = mergedRanges
}
