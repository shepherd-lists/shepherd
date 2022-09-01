import { tx as getTx } from 'ar-gql'
import axios from 'axios'
import { CHUNK_ALIGN_GENESIS, CHUNK_SIZE, } from './constants-byteRange'
import { HOST_URL, network_EXXX_codes } from '../../common/constants'
import { ans104HeaderData } from './ans104HeaderData'
import { byteRange102 } from './byteRange102'


/**
 * 
 * @param id either L1 or L2 id
 * @returns chunk aligned byte range >= the id's actual range in the weave data
 */
export interface ByteRange {
	status?: number
	start: bigint
	end: bigint
}
export const txidToRange = async (id: string) => {
	/** Plan!
	 * determine if L1 or L2
	 * 	L1 call `/tx/{id}/offset`. end.
	 * 	L2 check bundle ans102|ans104
	 * 		ans104
	 * 			fetch first chunk, get numDataItems
	 * 			get enough header chunks for entire bundle index
	 * 			get size & id arrays from bundle
	 * 			determine byte ranges to blacklist
	 * 		ans102 (these are rare)
	 * 			get entire bundle and calculate byte-range
	 */
	//get tx metadata
	const tx = await gqlTxRetried(id)
	if(!tx){
		throw new Error(`[${txidToRange.name}] getTxRetried(${id}) returned undefined. This should not be happening.`)
	}
	//handle L1
	if(!tx.parent || !tx.parent?.id){
		console.log(txidToRange.name, `L1 detected`, id)
		return offsetL1(id)
	}
	//handle L2 ans104 (arbundles)
	const txParent = await gqlTxRetried(tx.parent.id)
	if(
		txParent.tags.some(tag => tag.name === 'Bundle-Format' && tag.value === 'binary')
		&& txParent.tags.some(tag => tag.name === 'Bundle-Version' && tag.value === '2.0.0')
	){
		console.log(txidToRange.name, `ans104 detected. parent ${txParent.id}`)
		return byteRange104(id, tx.parent.id)
	}
	//handle L2 ans102 (arweave-bundles)
	if(
		txParent.tags.some(tag => tag.name === 'Bundle-Format' && tag.value === 'json')
		&& txParent.tags.some(tag => tag.name === 'Bundle-Version' && tag.value === '1.0.0')
	){
		console.log(txidToRange.name, `ans102 detected. parent ${txParent.id}`)
		return byteRange102(id, tx.parent.id)
	}

	return {
		start: -1n,
		end: -1n,
	}
}

const offsetL1 = async (id: string): Promise<ByteRange> => {
	const { data: { offset: end, size} } = await axiosRetried(`/tx/${id}/offset`, id)
	const modEnd = (BigInt(end) - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	const addEnd = modEnd === 0n ? 0n : CHUNK_SIZE - modEnd

	if(process.env['NODE_ENV'] === 'test') console.log({end, size, modEnd, addEnd})

	return {
		end: BigInt(end) + addEnd,
		start: BigInt(end) - BigInt(size),
	}
}

const byteRange104 = async (txid: string, parent: string) => {
	
	/* 1. fetch the bundle offsets */

	//TODO: check the parent was mined, via 404, while getting offset

	const { data: { offset: strBundleEnd , size: strBundleSize} } = await axiosRetried(`/tx/${parent}/offset`, txid)
	const bundleWeaveEnd = BigInt(strBundleEnd)
	const bundleWeaveSize = BigInt(strBundleSize)
	const bundleWeaveStart = bundleWeaveEnd - bundleWeaveSize
	
	/* 2. fetch the bundle index data */

	const { status, numDataItems, diIds, diSizes} = await ans104HeaderData(parent)
	if(status === 404) return {
		status,
		start: -1n,
		end: -1n,
	}

	/* now we can calculate the byte ranges for a dataItem */
	
	//calculate relative to bundle
	let start = BigInt(32 + numDataItems * 64)
	const indexTxid = diIds.indexOf(txid)
	for(let i = 0; i < indexTxid; i++) {
		start += BigInt(diSizes[i])
	}
	let end = start + BigInt(diSizes[indexTxid])
	if(process.env.NODE_ENV ==='test') console.log(`bundle relative`, {start, end, indexTxid})

	//unaligned dataItem range
	let weaveStartUnaligned = start + bundleWeaveStart 
	let weaveEndUnaligned = end + bundleWeaveStart
	//aligned to chunks
	let modStart = (weaveStartUnaligned - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	let modEnd = (weaveEndUnaligned - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	//ensure these are positive (hack)
	modStart = modStart < 0n ? -modStart : modStart
	modEnd = modEnd < 0n ? -modEnd : modEnd
	const addEnd = modEnd === 0n ? 0n : CHUNK_SIZE - modEnd

	if(process.env.NODE_ENV ==='test') console.log('weave actual', {startActual: weaveStartUnaligned, endActual: weaveEndUnaligned, bundleStart: bundleWeaveStart}, 'mods', {modStart, modEnd, addEnd})

	let weaveStart = weaveStartUnaligned - modStart
	let weaveEnd = weaveEndUnaligned + addEnd

	/* hack for older pre-aligned weave */

	if(bundleWeaveStart < CHUNK_ALIGN_GENESIS){
		console.info(`${txid}: ${bundleWeaveStart} is less than CHUNK_ALIGN_GENESIS`)
		//clamp the byte range to bundle limits
		if(weaveStart < bundleWeaveStart) weaveStart = bundleWeaveStart
		if(weaveEnd > bundleWeaveEnd) weaveEnd = bundleWeaveEnd
	}

	/* final sanity checks */
	if(bundleWeaveStart >= CHUNK_ALIGN_GENESIS){
		if((weaveStart - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE !== 0n) throw new Error(`post-CHUNK_ALIGN_GENESIS weaveStart not on chunk alignment`)
		if((weaveEnd - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE !== 0n) throw new Error(`post-CHUNK_ALIGN_GENESIS weaveEnd not on chunk alignment`)
	}
	if(weaveStart > weaveEnd) throw new Error(`weaveStart cannot be greater than weaveEnd`)
	if((weaveEnd - weaveStart) < BigInt(diSizes[indexTxid])) throw new Error(`byte range too small to contain dataItem`)
	if(weaveStart < bundleWeaveStart) throw new Error(`weaveStart out of range`)
	if(weaveEnd > (bundleWeaveEnd + addEnd)) throw new Error(`weaveEnd out of range`) //not the cleanest test

	/* final values */
	if(process.env.NODE_ENV === 'test') console.info(`return`, {weaveStart, weaveEnd})
	return{
		start: weaveStart,
		end: weaveEnd,
	}
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const axiosRetried = async (url: string, id: string) => {
	while(true){
		try{
			return await axios.get(HOST_URL + url)
		}catch(e:any){
			//no point retrying 404 errors?
			const status = Number(e.response?.status) || Number(e.statusCode) || null
			if(status === 404){
				console.log (axiosRetried.name, `Error fetching byte-range data with '${HOST_URL + url}' Not retrying.`, e.name, e.message, '. child-id', id)

				throw e;
			}
			console.log (axiosRetried.name, `Error fetching byte-range data with '${HOST_URL + url}' Retrying in 10secs..`, e.name, e.message, id)
			await sleep(10000)
		}
	}
}
const gqlTxRetried = async (id: string) => {
	while(true){
		try{
			return await getTx(id)
		}catch(e:any){
			const status = Number(e.response?.status) || Number(e.statusCode) || null
			const code = e.response?.code || e.code || 'no-code'

			if(status === 429 || network_EXXX_codes.includes(code) || (status && status >= 500)){
				console.log(gqlTxRetried.name, `gql-fetch-error: '${e.message}', for '${id}'. retrying in 10secs...`)
				await sleep(10000)
			}else{
				console.log(e)
				throw new Error(`unexpected gql-fetch-error: ${e.message} for id ${id}`)
			}
		}
	}
}
