import { s3GetObject, s3ListFolderObjects } from '../utils/s3-services'
import { ByteRange } from './merge-ranges';
import { normalizedRanges, NormalizedRanges, UniqTxidArray, uniqTxidArray } from './ram-lists'
import { getLastModified } from './update-lists';


const LISTS_BUCKET = process.env.LISTS_BUCKET as string

/** N.B. 
 * we have to split up txid & range caching. they are handled in separate processes. 
 * no, this doesn't mean the s3 files get read twice, just the folder contents list.
 * 
 * so remember, no "shared" data here outside of the functions.
 */


export const initTxidsCache = async (listdir: string) => {
	//get all file names
	const files = await s3ListFolderObjects(LISTS_BUCKET, listdir)
	const lastModified = await getLastModified(listdir)
	//filter for txids
	const txidFiles = files.filter(f => f.includes('txids'))

	//ascending sort, we need to apply updates in order
	txidFiles.sort()

	const txids = uniqTxidArray() //this is our ram cached list

	//read each update file and apply to txids accordingly
	for (const filename of txidFiles) {
		const lines = (await s3GetObject(LISTS_BUCKET, filename)).split('\n')
		lines.pop()

		for (const line of lines) {
			//line is either `txid` or `txid,remove`
			const split = line.split(',')
			const txid = split[0]
			const remove = split.length === 2
			if (remove) {
				txids.remove(txid)
			} else {
				txids.add(txid)
			}
		}
	}

	return {
		txids,
		lastModified,
	};
}

export const updateTxidsCache = async ({
	txidsCache, previousModified, listdir
}: {
	txidsCache: UniqTxidArray
	listdir: string
	previousModified: number
}) => {
	const files = await s3ListFolderObjects(LISTS_BUCKET, listdir)
	const lastModified = await getLastModified(listdir)

	//filenames are of form: `txids_<date-string>.<timestamp>.txt`
	const newFiles = files.filter(f => f.includes('txids') && Number(f.split('.')[1]) > previousModified)

	newFiles.sort()
	for (const file of newFiles) {
		const lines = (await s3GetObject(LISTS_BUCKET, file)).split('\n')
		lines.pop()
		for (const line of lines) {
			const split = line.split(',')
			const txid = split[0]
			const remove = split.length === 2
			if (remove) {
				txidsCache.remove(txid) //splice - retry on error higher up
			} else {
				txidsCache.add(txid) //push
			}
		}
	}
	//return last modified only, we're directly modifying the cache in place
	return {
		lastModified,
	}
}

export const initRangesCache = async (listdir: string) => {
	const files = await s3ListFolderObjects(LISTS_BUCKET, listdir)
	const lastModified = await getLastModified(listdir)

	const rangeFiles = files.filter(f => f.includes('ranges'))
	rangeFiles.sort()

	//5. ranges will require a more complicated add/remove logic, as they can overlap and need to be merged
	const ranges = normalizedRanges()

	let rangesCount = 0
	for (const filename of rangeFiles) {
		let lines: string[] | null = (await s3GetObject(LISTS_BUCKET, filename)).split('\n')
		lines.pop()

		//i feel like we could do better than processing 1 range at a time
		for (const line of lines) {
			rangesCount++
			//line is either `start,end` or `start,end,remove`
			const split = line.split(',')
			const start = parseInt(split[0])
			const end = parseInt(split[1])
			const remove = split.length === 3
			if (!remove) {
				ranges.add([[start, end]]) //these take arrays of ByteRanges
			} else {
				ranges.remove([[start, end]]) //ditto
			}
			if (rangesCount % 100_000 === 0) {
				console.info(initRangesCache.name, `inputted ${rangesCount} total ranges. merging...`)
				await ranges.getRanges() //does a merge to keep ram down
			}
		}
		//free heap
		lines = null
	}

	return {
		ranges,
		lastModified,
	};
}

export const updateRangesCache = async ({
	listdir, rangesCache, previousModified
}: {
	listdir: string,
	rangesCache: NormalizedRanges,
	previousModified: number
}) => {
	const files = await s3ListFolderObjects(LISTS_BUCKET, listdir)
	const lastModified = await getLastModified(listdir)

	const newFiles = files.filter(f =>
		f.includes('ranges')
		&& Number(f.split('.')[1]) > previousModified
	)
	newFiles.sort()
	for (const file of newFiles) {
		const lines = (await s3GetObject(LISTS_BUCKET, file)).split('\n')
		lines.pop()
		for (const line of lines) {
			const split = line.split(',')
			const range: ByteRange = [parseInt(split[0]), parseInt(split[1])]
			const remove = split.length === 3
			if (remove)
				rangesCache.remove([range])
			else
				rangesCache.add([range])
		}
	}
	return {
		lastModified,
	}
}

