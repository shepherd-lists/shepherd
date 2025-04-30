import { s3GetObject, s3GetObjectWebStream, s3ListFolderObjects } from '../utils/s3-services'
import { normalizedRanges, uniqTxidArray } from './ram-lists'


const LISTS_BUCKET = process.env.LISTS_BUCKET as string


export const initRamList = async (listdir: string) => {
	//1. get all file names
	const files = await s3ListFolderObjects(LISTS_BUCKET, listdir)
	//2. filter into 2 lists: one for txid and one for range
	const [txidFiles, rangeFiles] = files.reduce<[string[], string[]]>((acc, s) => {
		acc[s.includes('txid') ? 0 : 1].push(s)
		return acc;
	}, [[], []])

	//3. ascending sort txids and ranges. we need to apply updates in order
	txidFiles.sort()
	rangeFiles.sort()

	//4. read each update file and apply to txids accordingly
	const txids = uniqTxidArray() //this is our ram cached list

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

	//5. ranges will require a more complicated add/remove logic, as they can overlap and need to be merged
	const ranges = normalizedRanges()

	for (const filename of rangeFiles) {
		const lines = (await s3GetObject(LISTS_BUCKET, filename)).split('\n')
		lines.pop()

		//i feel like we could do better than processing 1 range at a time
		for (const line of lines) {
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
		}
	}
	await ranges.getRanges() // pre-process the ranges.

	return {
		txids,
		ranges,
	}
}
