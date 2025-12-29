import { s3GetObjectWebStream, s3HeadObject } from "../../../../libs/utils/s3-services"
import { slackLog } from "../../../../libs/utils/slackLog"
import { performance } from 'perf_hooks'
import { readlineWeb } from "../../../../libs/utils/webstream-utils"
import { getLastModified } from "../../../../libs/s3-lists/update-lists"
import { FolderName } from '../types'
import { NormalizedRanges } from "../../../../libs/s3-lists/ram-lists"
import { initRangesCache, updateRangesCache } from "../../../../libs/s3-lists/read-lists"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


export type ByteRange = [number, number]

interface RangeCache {
	lastModified: number
	ranges: NormalizedRanges | undefined
	inProgress: boolean
}
const _rangeCache: { [key: string]: RangeCache } = {}


export const getBlockedRanges = async (listdir: FolderName) => {

	const lastModified = await getLastModified(listdir)

	/** init empty */
	if (!_rangeCache[listdir]) _rangeCache[listdir] = {
		lastModified: 0,
		ranges: undefined,
		inProgress: false
	}

	/** short-circuit */
	if (lastModified === _rangeCache[listdir].lastModified) {
		console.info(getBlockedRanges.name, `returning ${listdir} cache`)
		return _rangeCache[listdir].ranges
	}

	/** just one running update is allowed/required */
	if (_rangeCache[listdir].inProgress) {
		console.info(getBlockedRanges.name, listdir, 'waiting for cache update as inProgress')
		while (_rangeCache[listdir].inProgress) {
			await sleep(100) //wait for new cache
		}
		console.info(getBlockedRanges.name, listdir, 'returning cache')
		return _rangeCache[listdir].ranges
	}
	_rangeCache[listdir].inProgress = true

	/** fetch rangelist.txt */

	console.info(getBlockedRanges.name, listdir, 'create/update cache...')
	const t0 = performance.now()

	if (_rangeCache[listdir].ranges === undefined) {
		const { lastModified, ranges } = await initRangesCache(listdir)
		_rangeCache[listdir] = { lastModified, ranges, inProgress: false }
	} else {
		const { lastModified } = await updateRangesCache({
			listdir,
			previousModified: _rangeCache[listdir].lastModified,
			rangesCache: _rangeCache[listdir].ranges,
		})
		_rangeCache[listdir].lastModified = lastModified
		_rangeCache[listdir].inProgress = false
	}

	/** finish up */
	const t1 = performance.now()
	console.info(getBlockedRanges.name, listdir, `fetched latest cached ranges in ${(t1 - t0).toFixed(0)}ms`)

	return _rangeCache[listdir].ranges
}

// setInterval(() => getBlockedRanges('list/'), 5_000)
