import { s3GetObjectWebStream, s3HeadObject } from "../../../../libs/utils/s3-services"
import { slackLog } from "../../../../libs/utils/slackLog"
import { performance } from 'perf_hooks'
import { readlineWeb } from "../../../../libs/utils/webstream-utils"
import { mergeErlangRanges } from "../../../../libs/s3-lists/merge-ranges"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


export type ByteRange = [number, number]

export type RangeKey = 'rangelist.txt' | 'rangeflagged.txt' | 'rangeowners.txt' //not using these outside of test anymore

interface RangeCache {
	eTag: string
	ranges: Array<ByteRange>
	inProgress: boolean
}
const _rangeCache: { [key: string]: RangeCache } = {}


export const getBlockedRanges = async (key: RangeKey = 'rangelist.txt'): Promise<ByteRange[]> => {
	/** create entry */
	if (!_rangeCache[key]) _rangeCache[key] = { eTag: '', ranges: [], inProgress: false }

	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, key)).ETag!
	// console.debug(getBlockedRanges.name, key, 'eTag', eTag)

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
		//sanity
		if (line.length < 3) {
			slackLog(getBlockedRanges.name, `WARNING! bad line "${line}" retrieving ${key}`)
			continue;
		}
		const [start, end] = line.split(',').map(Number) as ByteRange
		ranges.push([start, end])
	}
	const t1 = performance.now()
	console.info(getBlockedRanges.name, key, `fetched ${ranges.length} ranges in ${(t1 - t0).toFixed(0)}ms`)

	/** merge contiguous ranges */

	const mergedRanges: ByteRange[] = mergeErlangRanges(ranges)

	const t2 = performance.now()
	console.info(getBlockedRanges.name, key, `sorted & merged to ${mergedRanges.length} ranges in ${(t2 - t1).toFixed(0)}ms.`)

	/** finish up */

	console.info(getBlockedRanges.name, key, `Total caching time: ${(t2 - t0).toFixed(0)}ms`)
	_rangeCache[key].inProgress = false
	return _rangeCache[key].ranges = mergedRanges
}
