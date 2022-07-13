import axios from 'axios'
import { DataItem, unbundleData } from 'arbundles'
import { logger } from '../common/utils/logger'
import { updateTxsDb } from '../common/utils/db-update-txs'
import { HOST_URL } from '../common/constants'

/**
 * ** THIS IS MVP ONLY FOR NOW **
 * 
 * It needs to be cleaned up! For example:
 * - we dont really need to be holding an entire ans104 bundle in ram.
 * - we can stream the header and cancel the rest of the download - need to process the binary header ourselves.
 * - this only supports the current ans104 bundle standard. missing ans102 (and previous versions?).
 * 
 * @param wantedId the id of the dataItem we want byte ranges for.
 * @param bundleId the id of the arbundle it's in. 
 * @returns the byte range of the dataItem in weave data indices.
 */
export const byteRanges = async (wantedId: string, bundleId: string) => {

	/* get bundle infos */

	const { data } = await axiosRetried(`${HOST_URL}/${bundleId}`, 'arraybuffer')
	logger(byteRanges.name, data.length, 'bytes found in arweave.net cache')

	const bundle = unbundleData(data)
	let wantedIndex = bundle.getIds().indexOf(wantedId)
	const dataItemSizes = bundle.getSizes()
	const wantedIdSize = bundle.getSizes()[wantedIndex]
	let reverseEndOffset = 0
	for (let i = wantedIndex+1; i < dataItemSizes.length; i++) {
		reverseEndOffset += dataItemSizes[i]
	}
	const reverseStartOffset = reverseEndOffset + wantedIdSize
	logger(byteRanges.name, {
		wantedId,
		dataItemSizes,
		wantedIndex,
		wantedIdSize,
		reverseStartOffset,
		reverseEndOffset,
	})

	/* get weave data indices */

	const { data: data2} = await axiosRetried(`${HOST_URL}/tx/${bundleId}/offset`, 'json')
	logger(byteRanges.name, data2)
	const byteRange = {
		byteStart: BigInt(data2.offset) + 1n - BigInt(reverseStartOffset),
		byteEnd: BigInt(data2.offset) + 1n - BigInt(reverseEndOffset),
	}
	logger(byteRanges.name, byteRange)

	const checkId = await updateTxsDb(wantedId, { 
		byteStart: byteRange.byteStart.toString(),
		byteEnd: byteRange.byteEnd.toString(), 
	})
	if(checkId !== wantedId){
		throw new Error(`Error writing byte-range to database! Wanted '${wantedId}'. Returned '${checkId}'.`)
	}

	return byteRange;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const axiosRetried = async (url: string, responseType: ('json'|'arraybuffer')) => {
	while(true){
		try{
			return await axios.get(url, { responseType })
		}catch(e:any){
			logger(axiosRetried.name, `Error fetching byte-range data with '${url}' Retrying in 10secs..`, e.name, e.message)
			await sleep(10000)
		}
	}
}