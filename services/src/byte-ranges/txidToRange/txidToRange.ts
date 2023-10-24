import axios, { AxiosError } from 'axios'
import { CHUNK_ALIGN_GENESIS, CHUNK_SIZE, } from './constants-byteRange'
import { GQL_URL, GQL_URL_SECONDARY, HOST_URL } from '../../common/constants'
import { ans104HeaderData } from './ans104HeaderData'
import { byteRange102 } from './byteRange102'
import moize from 'moize'
import { arGql, ArGqlInterface } from 'ar-gql'


if(!GQL_URL || !GQL_URL_SECONDARY || !HOST_URL) throw new Error(`Missing env vars, GQL_URL:${GQL_URL}, GQL_URL_SECONDARY:${GQL_URL_SECONDARY}, HOST_URL:${HOST_URL}`)


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
export const txidToRange = async (id: string, parent: string|null, parents: string[] | undefined) => {
	/**
	 * Overview:
	 * determine if L1 or L2
	 * 	L1 call `/tx/{id}/offset`. end.
	 * 	L2 check bundle ans102|ans104
	 * 		ans104
	 * 			fetch first chunk, get numDataItems
	 * 			get enough header chunks for entire bundle index
	 * 			-- we've reverted to using arweave.net cache. much faster
	 * 			-- open a stream, then cancel it when have enough header bytes
	 * 			get size & id arrays from bundle
	 * 			determine byte ranges to blacklist
	 * 		ans102 (these are rare)
	 * 			get entire bundle and calculate byte-range
	 */

	/* handle L1 */
	if(parent === null){
		console.log(txidToRange.name, 'L1 detected', id)
		return offsetL1(id)
	}
	//handle L2 ans104 (arbundles)

	const gql1 = arGql(GQL_URL)

	let txParent = await gqlTxRetry(parent, gql1)
	/** handle bugs in the gql indexing services */
	if(!txParent){
		const gql2 = arGql(GQL_URL_SECONDARY)
		txParent = await gqlTxRetry(parent, gql2)
		//fail fast
		if(!txParent){
			throw new Error(`Parent ${parent} not found using ${GQL_URL} or ${GQL_URL_SECONDARY}`)
		}
	}

	if(
		txParent.tags.some(tag => tag.name === 'Bundle-Format' && tag.value === 'binary')
		&& txParent.tags.some(tag => tag.name === 'Bundle-Version' && tag.value === '2.0.0')
	){
		console.log(id, txidToRange.name, `ans104 detected. parent ${txParent.id}`)
		return byteRange104(id, parent, parents)
	}
	//handle L2 ans102 (arweave-bundles)
	if(
		txParent.tags.some(tag => tag.name === 'Bundle-Format' && tag.value === 'json')
		&& txParent.tags.some(tag => tag.name === 'Bundle-Version' && tag.value === '1.0.0')
	){
		console.log(id, txidToRange.name, `ans102 detected. parent ${txParent.id}`)
		return byteRange102(id, parent)
	}

	return {
		start: -1n,
		end: -1n,
	}
}

const offsetL1 = async (id: string): Promise<ByteRange> => {
	const { data: { offset: end, size} } = await axiosRetryUnmemoized(`/tx/${id}/offset`, id)
	const modEnd = (BigInt(end) - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	const addEnd = modEnd === 0n ? 0n : CHUNK_SIZE - modEnd

	if(process.env['NODE_ENV'] === 'test') console.log({end, size, modEnd, addEnd})

	return {
		end: BigInt(end) + addEnd,
		start: BigInt(end) - BigInt(size),
	}
}

const byteRange104 = async (txid: string, parent: string, parents: string[] | undefined) => {

	/* 1. fetch the bundle offsets */

	const L1Parent = parents ? parents[parents.length - 1] : parent

	const { data: { offset: strL1End , size: strL1Size} } = await axiosRetry(`/tx/${L1Parent}/offset`, txid)
	const L1WeaveEnd = BigInt(strL1End)
	const L1WeaveSize = BigInt(strL1Size)
	const L1WeaveStart = L1WeaveEnd - L1WeaveSize

	/* 2. fetch the bundle index data */

	const headerDatas: {
    status: number
    numDataItems: number
    diIds: string[]
    diSizes: number[]
		headerLength: bigint
	}[] = []


	const header0 = await ans104HeaderData(parent)
	if(header0.status === 404) return {
		status: header0.status,
		start: -1n,
		end: -1n,
	}

	if(parents){
		for(let i = 0; i < parents.length; i++){
			const header = await ans104HeaderData(parents[i])
			if(header.status === 404) return {
				status: header0.status,
				start: -1n,
				end: -1n,
			}
			headerDatas.push(header)
		}
	}

	/* now we can calculate the byte ranges for a dataItem */

	let start = 0n

	//calculate start relative to first parent
	start = header0.headerLength
	const indexTxid = header0.diIds.indexOf(txid)
	for(let i = 0; i < indexTxid; i++){
		start += BigInt(header0.diSizes[i])
	}

	if(process.env.NODE_ENV ==='test') console.log('1st parent, start', start)

	//loop through nested parents if they exist
	if(parents){
		for(let i = 0; i < headerDatas.length; i++){
			start += headerDatas[i].headerLength
			const indexParent = i == 0 ? headerDatas[i].diIds.indexOf(parent) : headerDatas[i].diIds.indexOf(parents[i - 1])
			for(let j = 0; j < indexParent; j++){
				start += BigInt(headerDatas[i].diSizes[j])
			}
			if(process.env.NODE_ENV ==='test') console.log(`parent[${i}]`, {start, indexParent})
		}
	}

	const size = BigInt(header0.diSizes[indexTxid])
	const end = start + size
	if(process.env.NODE_ENV ==='test') console.log('bundle relative', {start, end, size, indexTxid, parent, parents })

	//unaligned dataItem range
	const weaveStartUnaligned = start + L1WeaveStart
	const weaveEndUnaligned = end + L1WeaveStart
	//aligned to chunks
	let modStart = (weaveStartUnaligned - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	let modEnd = (weaveEndUnaligned - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	//ensure these are positive (hack)
	modStart = modStart < 0n ? -modStart : modStart
	modEnd = modEnd < 0n ? -modEnd : modEnd
	const addEnd = modEnd === 0n ? 0n : CHUNK_SIZE - modEnd

	if(process.env.NODE_ENV ==='test') console.log('weave actual', {startActual: weaveStartUnaligned, endActual: weaveEndUnaligned, L1WeaveStart}, 'mods', {modStart, modEnd, addEnd})

	let weaveStart = weaveStartUnaligned - modStart
	let weaveEnd = weaveEndUnaligned + addEnd

	/* hack for older pre-aligned weave */

	if(L1WeaveStart < CHUNK_ALIGN_GENESIS){
		console.info(`${txid}: ${L1WeaveStart} is less than CHUNK_ALIGN_GENESIS`)
		//clamp the byte range to bundle limits
		if(weaveStart < L1WeaveStart) weaveStart = L1WeaveStart
		if(weaveEnd > L1WeaveEnd) weaveEnd = L1WeaveEnd
	}

	/* final sanity checks */
	if(L1WeaveStart >= CHUNK_ALIGN_GENESIS){
		if((weaveStart - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE !== 0n) throw new Error('post-CHUNK_ALIGN_GENESIS weaveStart not on chunk alignment')
		if((weaveEnd - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE !== 0n) throw new Error('post-CHUNK_ALIGN_GENESIS weaveEnd not on chunk alignment')
	}
	if(weaveStart > weaveEnd) throw new Error('weaveStart cannot be greater than weaveEnd')
	if((weaveEnd - weaveStart) < BigInt(header0.diSizes[indexTxid])) throw new Error('byte range too small to contain dataItem')
	if(weaveStart < L1WeaveStart) throw new Error('weaveStart out of range')
	if(weaveEnd > (L1WeaveEnd + addEnd)) throw new Error('weaveEnd out of range') //not the cleanest test

	/* final values */
	if(process.env.NODE_ENV === 'test') console.info('return', {weaveStart, weaveEnd})
	return {
		start: weaveStart,
		end: weaveEnd,
	}
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const axiosRetryUnmemoized = async (url: string, id: string) => {
	while(true){
		try{
			return await axios.get(HOST_URL + url)
		}catch(err:unknown){
			const e = err as AxiosError & { statusCode?: number }
			//no point retrying 404 errors?
			const status = Number(e.response?.status) || Number(e.statusCode) || null
			if(status === 404){
				console.log (axiosRetryUnmemoized.name, `Error fetching byte-range data with '${HOST_URL + url}' Not retrying.`, e.name, e.message, '. child-id', id)

				throw e
			}
			console.log (axiosRetryUnmemoized.name, `Error fetching byte-range data with '${HOST_URL + url}' Retrying in 10secs..`, e.name, e.message, id)
			await sleep(10000)
		}
	}
}
const axiosRetry = moize(axiosRetryUnmemoized, { maxSize: 1000, isPromise: true })
const gqlTxRetryUnmemoized = async (id: string, gql: ArGqlInterface) => {
	while(true){
		try{

			return await gql.tx(id)

		}catch(err:unknown){
			const e = err as Error & { cause?: number }
			const status = e.cause ? +e.cause : null

			// check errors: connection || rate-limit || server
			if(!status || status === 429 || status >= 500){
				console.log(gqlTxRetryUnmemoized.name, `gql-fetch-error: (${status}) '${e.message}', for '${id}'. retrying in 10secs...`)
				await sleep(10000)
				continue
			}

			console.log(e)
			throw new Error(`unexpected gql-fetch-error: (${status}) ${e.message} for id ${id}`)
		}
	}
}
const gqlTxRetry = moize(gqlTxRetryUnmemoized, { maxSize: 1000, isPromise: true })
