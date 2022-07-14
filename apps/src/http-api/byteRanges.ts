import axios from 'axios'
import { unbundleData } from 'arbundles'
import { logger } from '../common/utils/logger'
import { updateTxsDb } from '../common/utils/db-update-txs'
import { HOST_URL } from '../common/constants'
import dbConnection from '../common/utils/db-connection'
import { TxRecord } from '../common/types'

const knex = dbConnection()


const CHUNK_ALIGN_GENESIS = 30607159107830n //weave address where enforced 256kb chunks started
const CHUNK_SIZE = 262144n //256kb

/**
 * ** THIS IS MVP ONLY FOR NOW **
 * 
 * It needs to be cleaned up! For example:
 * - we dont really need to be holding an entire ans104 bundle in ram.
 * - we can stream the header and cancel the rest of the download - need to process the binary header ourselves.
 * - this only supports the current ans104 bundle standard. missing ans102 (and previous versions?).
 * 
 * @param wantedId the id of the dataItem we want byte ranges for.
 * @returns (for test only) the byte range of the dataItem in weave data aligned to chunk boundaries
 */
export const byteRanges = async (wantedId: string) => {

	/* check if this positive flag has a parent */

	const [{ parent }] = await knex<TxRecord>('txs').select('parent').where({ txid: wantedId })
	if(!parent){
		logger(byteRanges.name, `no parent tx found for txid ${wantedId}`)
		return { byteStart:0, byteEnd:0 }; //return for test only
	}

	/* get bundle infos */

	const { data } = await axiosRetried(`${HOST_URL}/${parent}`, 'arraybuffer')
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

	// get actual dataItem offsets
	const { data: data2} = await axiosRetried(`${HOST_URL}/tx/${parent}/offset`, 'json')
	logger(byteRanges.name, data2)
	const dataRange = {
		byteStart: BigInt(data2.offset) + 1n - BigInt(reverseStartOffset),
		byteEnd: BigInt(data2.offset) + 1n - BigInt(reverseEndOffset),
	}
	logger(byteRanges.name, 'dataItem range', dataRange)

	//get aligned to chunk offsets
	const modStart = (dataRange.byteStart - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	const modEnd = (dataRange.byteEnd - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	const addEnd = modEnd === 0n ? 0n : CHUNK_SIZE - modEnd
	const chunkRange = {
		byteStart: dataRange.byteStart - modStart ,
		byteEnd: dataRange.byteEnd + addEnd,
	}
	logger(byteRanges.name, 'chunk range', chunkRange)

	/* update database - (expensive to do this separetely, consider combined operation) */

	const checkId = await updateTxsDb(wantedId, { 
		byteStart: chunkRange.byteStart.toString(),
		byteEnd: chunkRange.byteEnd.toString(), 
	})
	if(checkId !== wantedId){
		throw new Error(`Error writing byte-range to database! Wanted '${wantedId}'. Returned '${checkId}'.`)
	}

	return chunkRange; //useds for test
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
