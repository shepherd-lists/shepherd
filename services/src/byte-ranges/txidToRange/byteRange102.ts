/**
 * ans102 bundles are just JSON objects. calculating offsets is about counting characters in stringified JSONs.
 * there's no index table so the entire L1 data needs to be downloaded.
 * //!const items: DataItemJson[] = await arweaveBundles.unbundleData(data) // we can't use this.
 * `unbundleData` filters dataItems that don't validate, so this will interefere with our size calculations.
 */
import { CHUNK_ALIGN_GENESIS, CHUNK_SIZE } from './constants-byteRange'
import { HOST_URL } from '../../common/constants'
import { fetchFullRetried } from './fetch-retry'
import moize from 'moize'

const fetchFullRetriedMemo = moize(fetchFullRetried, { maxSize: 1000, isPromise: true })

//DataItemJson is actually the only thing we need from arweave-bundles package
class DataItemJson {
	owner: string = ''
	target: string = ''
	nonce: string = ''
	tags: { name: string; value: string }[] = []
	data: string = ''
	signature: string = ''
	id: string = ''
}

//some ans102 constants
const head_size = '{"items":['.length
const end_size = ']}'.length

const fetchHeaderInfo = async(txid: string, parent: string)=> {

	/* fetch the entire L1 parent data & sanity check */

	const { status, json: bundleJson } = await fetchFullRetried(`${HOST_URL}/${parent}`)
	if(status === 404) return {
		status,
		diSizes: [] as number[], indexTxid: -1, //keep ts happy
	}

	const {items} = bundleJson as { items: DataItemJson[] }
	let indexTxid: number | undefined
	const diSizes: number[] = []
	for(let i = 0; i < items.length; i++){
		const id = items[i].id
		const size = JSON.stringify(items[i]).length
		if(id === txid) indexTxid = i
		diSizes.push(size)
		if(process.env.NODE_ENV === 'test') console.debug({i, id, size})
	}
	//sanity
	if(indexTxid === undefined) throw new Error('indexTxid not defined')

	return {
		diSizes,
		indexTxid,
	}
}
const fetchHeaderInfoMemo = moize(fetchHeaderInfo, { maxSize: 1000, isPromise: true })

export const byteRange102 = async(txid: string, parent: string)=> {

	/* fetch the L1 parent header details (expensive) */

	const {status, diSizes, indexTxid} = await fetchHeaderInfoMemo(txid, parent)
	if(status === 404) return {
		status,
		start: -1n, end: -1n,
	}

	/* get weave offset & sanity check */

	const { status: statusOffset, json } = await fetchFullRetriedMemo(`${HOST_URL}/tx/${parent}/offset`)
	if(statusOffset === 404) return {
		status: statusOffset,
		start: -1n, end: -1n,
	}
	const offset = json as {size: string, offset: string}
	const bundleWeaveEnd = BigInt(offset.offset) //using bigints as `weaveSize ~= Number.MAX_SAFE_INTEGER / 100`, as of 2022-08-10
	const bundleWeaveSize = BigInt(offset.size)
	const bundleWeaveStart = bundleWeaveEnd - bundleWeaveSize

	//sanity
	const totalLength = head_size + diSizes.reduce((total, size)=> total += size + 1, 0) - 1 + end_size //1s are for `,` characters in between
	if(BigInt(totalLength) !== bundleWeaveSize) throw new Error(`totalLength ${totalLength} !== bundleWeaveSize ${bundleWeaveSize}`)

	/* calculate range within the bundle */

	const start = head_size + diSizes.slice(0, indexTxid).reduce((sum, size) => sum += size + 1, 0)
	const end = start + diSizes[indexTxid]

	if(process.env.NODE_ENV === 'test') console.debug({bundleWeaveStart, bundleWeaveSize, bundleWeaveEnd, indexTxid, start, end})

	/* calculate range within the weave & align to chunk boundary */

	//unaligned values
	const weaveStartUnaligned = bundleWeaveStart + BigInt(start)
	const weaveEndUnaligned = bundleWeaveStart + BigInt(end)

	//align to chunk
	let modStart = (weaveStartUnaligned - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	let modEnd = (weaveEndUnaligned - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	//ensure these are positive (hack)
	modStart = modStart < 0n ? -modStart : modStart
	modEnd = modEnd < 0n ? -modEnd : modEnd
	const addEnd = modEnd === 0n ? 0n : CHUNK_SIZE - modEnd

	let weaveStart = weaveStartUnaligned - modStart
	let weaveEnd = weaveEndUnaligned + addEnd

	if(process.env.NODE_ENV === 'test') console.debug({weaveStart, modStart, weaveEnd, addEnd,
		rangeSize: weaveEnd - weaveStart,
		rangeUnaligned: weaveEndUnaligned - weaveStartUnaligned
	})

	/* hack for older pre-aligned weave */

	if(bundleWeaveStart < CHUNK_ALIGN_GENESIS){
		console.info(`${txid}: ${bundleWeaveStart} is less than CHUNK_ALIGN_GENESIS`)
		//clamp the byte range to bundle limits
		if(weaveStart < bundleWeaveStart) weaveStart = bundleWeaveStart
		if(weaveEnd > bundleWeaveEnd) weaveEnd = bundleWeaveEnd
	}

	/* final sanity checks */

	if(bundleWeaveStart >= CHUNK_ALIGN_GENESIS){
		if((weaveStart - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE !== 0n) throw new Error('post-CHUNK_ALIGN_GENESIS weaveStart not on chunk alignment')
		if((weaveEnd - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE !== 0n) throw new Error('post-CHUNK_ALIGN_GENESIS weaveEnd not on chunk alignment')
	}
	if(weaveStart > weaveEnd) throw new Error('weaveStart cannot be greater than weaveEnd')
	if((weaveEnd - weaveStart) < BigInt(diSizes[indexTxid])) throw new Error('byte range too small to contain dataItem')
	if(weaveStart < bundleWeaveStart) throw new Error('weaveStart out of range')
	if(weaveEnd > (bundleWeaveEnd + addEnd)) throw new Error('weaveEnd out of range') //not the cleanest test

	/* final values */

	if(process.env.NODE_ENV === 'test') console.debug('return', {weaveStart, weaveEnd})
	return {
		start: weaveStart,
		end: weaveEnd,
	}
}
