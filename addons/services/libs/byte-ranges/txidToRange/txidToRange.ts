import { CHUNK_ALIGN_GENESIS, CHUNK_SIZE, HOST_URL, GQL_URL_SECONDARY, GQL_URL } from './constants-byteRange'
import { ans104HeaderData } from './ans104HeaderData'
import { byteRange102 } from './byteRange102'
import moize from 'moize'
import { arGql, ArGqlInterface } from 'ar-gql'
import { slackLog } from '../../utils/slackLog'
import { gqlTx } from '../gqlTx'
import { httpApiNodes } from '../../utils/update-range-nodes'
import { fetchChunkData } from '../../chunkStreams/chunkFetch'
import { ingressNodes } from '../../chunkStreams/ingress-nodes'


if (!HOST_URL) throw new Error('Missing HOST_URL')

/**
 *
 * @param id either L1 or L2 id
 * @returns chunk aligned byte range >= the id's actual range in the weave data
 */
export interface ByteRange {
	status?: number
	start: bigint
	end: bigint
	//export for data retrieval
	dataStart: bigint
	dataSize: bigint
}
export const txidToRange = async (id: string, parent: string | null, parents: string[] | undefined): Promise<ByteRange> => {
	/**
	 * Overview:
	 * determine if L1 or L2
	 * 	L1 call `/tx/{id}/offset`. end.
	 * 	L2 check bundle ans102|ans104
	 * 		ans104
	 * 			stream bundle data via chunkTxDataStream (chunk nodes)
	 * 			read enough header bytes, then abort the stream
	 * 			get size & id arrays from bundle
	 * 			determine byte ranges to blacklist
	 * 		ans102 (these are rare)
	 * 			get entire bundle and calculate byte-range
	 */

	/* handle L1 */
	if (parent === null) {
		console.log(txidToRange.name, 'L1 detected', id)
		return offsetL1(id)
	}
	//handle L2 ans104 (arbundles)

	const gqlGold = arGql({ endpointUrl: GQL_URL_SECONDARY }) //defaults to goldsky

	let txParent = await gqlTx(parent, gqlGold)
	/** handle bugs in the gql indexing services */
	if (!txParent) {
		/** notify on missing parents */
		console.error(txidToRange.name, `Parent ${parent} not found using ${GQL_URL_SECONDARY}. Trying ${GQL_URL} next. id: ${id}`)
		const gqlArweave = arGql({ endpointUrl: GQL_URL }) //defaults to arweave
		txParent = await gqlTx(parent, gqlArweave)
		//fail fast
		if (!txParent) {
			slackLog(`Parent ${parent} not found using ${GQL_URL} or ${GQL_URL_SECONDARY}. id ${id}`) //overzealous? important not to miss this
			throw new Error(`Parent ${parent} not found using ${GQL_URL} or ${GQL_URL_SECONDARY}. id ${id}`)
		}
	}

	if (
		txParent.tags.some(tag => tag.name.toLowerCase() === 'bundle-format' && tag.value === 'binary')
		&& txParent.tags.some(tag => tag.name.toLowerCase() === 'bundle-version' && tag.value === '2.0.0')
	) {
		console.log(id, txidToRange.name, `ans104 detected. parent ${txParent.id}`)
		return byteRange104(id, parent, parents)
	}
	//handle L2 ans102 (arweave-bundles)
	if (
		txParent.tags.some(tag => tag.name === 'Bundle-Format' && tag.value === 'json')
		&& txParent.tags.some(tag => tag.name === 'Bundle-Version' && tag.value === '1.0.0')
	) {
		console.log(id, txidToRange.name, `ans102 detected. parent ${txParent.id}`)
		return byteRange102(id, parent)
	}

	return {
		start: -1n,
		end: -1n,
		dataStart: -1n,
		dataSize: -1n,
	}
}

const offsetL1 = async (id: string): Promise<ByteRange> => {
	const { offset: end, size } = await fetchRetryOffset(id)
	const modEnd = (BigInt(end) - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
	const addEnd = modEnd === 0n ? 0n : CHUNK_SIZE - modEnd

	if (process.env['NODE_ENV'] === 'test') console.log({ end, size, modEnd, addEnd })

	return {
		start: BigInt(end) - BigInt(size),
		end: BigInt(end) + addEnd,
		dataStart: 0n,
		dataSize: BigInt(size),
	}
}

const byteRange104 = async (txid: string, parent: string, parents: string[] | undefined): Promise<ByteRange> => {

	/* 1. fetch the bundle offsets */

	const L1Parent = parents ? parents[parents.length - 1] : parent

	const { offset: strL1End, size: strL1Size } = await fetchRetryOffset(L1Parent)
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


	const header0 = await ans104HeaderData(
		parent,
		parents ? parents[0] : null,
		parents && parents.length > 1 ? parents.slice(1) : undefined,
	)
	if (header0.status === 404) return {
		status: header0.status,
		start: -1n, end: -1n,
		dataStart: -1n, dataSize: -1n,
	}

	if (parents) {
		for (let i = 0; i < parents.length; i++) {
			const header = await ans104HeaderData(
				parents[i],
				i + 1 < parents.length ? parents[i + 1] : null,
				i + 2 < parents.length ? parents.slice(i + 2) : undefined,
			)
			if (header.status === 404) return {
				status: header0.status,
				start: -1n, end: -1n,
				dataStart: -1n, dataSize: -1n,
			}
			headerDatas.push(header)
		}
	}

	/* now we can calculate the byte ranges for a dataItem */

	let start = 0n

	//calculate start relative to first parent
	start = header0.headerLength
	const indexTxid = header0.diIds.indexOf(txid)
	for (let i = 0; i < indexTxid; i++) {
		start += BigInt(header0.diSizes[i])
	}

	if (process.env.NODE_ENV === 'test') console.log('1st parent, start', start)

	//loop through nested parents if they exist
	if (parents) {
		for (let i = 0; i < headerDatas.length; i++) {
			const indexParent = i == 0 ? headerDatas[i].diIds.indexOf(parent) : headerDatas[i].diIds.indexOf(parents[i - 1])

			// add the data item header of the bundle at this nesting level
			// = full size in grandparent bundle - (inner bundle header + sum of all inner items)
			const innerHeader = i === 0 ? header0 : headerDatas[i - 1]
			const innerBundleSize = innerHeader.headerLength + BigInt(innerHeader.diSizes.reduce((a, b) => a + b, 0))
			start += BigInt(headerDatas[i].diSizes[indexParent]) - innerBundleSize

			start += headerDatas[i].headerLength
			for (let j = 0; j < indexParent; j++) {
				start += BigInt(headerDatas[i].diSizes[j])
			}
			if (process.env.NODE_ENV === 'test') console.log(`parent[${i}]`, { start, indexParent })
		}
	}

	const size = BigInt(header0.diSizes[indexTxid])
	const end = start + size
	if (process.env.NODE_ENV === 'test') console.log('bundle relative', { start, end, size, indexTxid, parent, parents })

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

	if (process.env.NODE_ENV === 'test') console.log('weave actual', { startActual: weaveStartUnaligned, endActual: weaveEndUnaligned, L1WeaveStart }, 'mods', { modStart, modEnd, addEnd })

	let weaveStart = weaveStartUnaligned - modStart
	let weaveEnd = weaveEndUnaligned + addEnd
	let dataStart = start - (weaveStart - L1WeaveStart)

	/**
	 * The last 2 chunks of a tx are split into arbitrary sizes by the uploader client (no fixed
	 * rule), each padded out to its 256KB bucket. /chunk2 returns only the real data, not the
	 * padding. The math above assumes every preceding chunk is a full CHUNK_SIZE, so for a
	 * dataItem whose data starts within those last 2 chunks it over-skips by the second-last
	 * chunk's padding. Correct it by reading the second-last chunk's real size from a node and
	 * recomputing weaveStart (the item's bucket) and dataStart (skip into the real bytes).
	 * Bundles always start on a chunk boundary, so L1WeaveStart is grid-aligned and the bucket
	 * offsets below are too.
	 */
	// only relevant when the L1 spans >1 chunk and isn't a whole number of chunks (=> a split, padded tail)
	const rebalanced = L1WeaveStart >= CHUNK_ALIGN_GENESIS && L1WeaveSize > CHUNK_SIZE && (L1WeaveSize % CHUNK_SIZE !== 0n)
	const tailPrefix = (L1WeaveSize / CHUNK_SIZE - 1n) * CHUNK_SIZE // packed bundle offset where the 2nd-last chunk's real data begins
	if (rebalanced && start >= tailPrefix) {
		const secondLastSize = BigInt(await chunkSizeAt(L1WeaveStart + tailPrefix))
		const lastDataStartPacked = tailPrefix + secondLastSize // packed bundle offset where the last chunk's real data begins
		const inLastChunk = start >= lastDataStartPacked
		const bucketPacked = inLastChunk ? tailPrefix + CHUNK_SIZE : tailPrefix
		weaveStart = L1WeaveStart + bucketPacked
		dataStart = start - (inLastChunk ? lastDataStartPacked : tailPrefix)
		// cover the dataItem from this bucket; round up to a chunk boundary
		const spanFromBucket = dataStart + size
		const spanMod = spanFromBucket % CHUNK_SIZE
		weaveEnd = weaveStart + spanFromBucket + (spanMod === 0n ? 0n : CHUNK_SIZE - spanMod)
		if (process.env.NODE_ENV === 'test') console.info('rebalanced tail', { tailPrefix, secondLastSize, inLastChunk, weaveStart, dataStart, weaveEnd })
	}

	/* hack for older pre-aligned weave */

	if (L1WeaveStart < CHUNK_ALIGN_GENESIS) {
		console.info(`${txid}: ${L1WeaveStart} is less than CHUNK_ALIGN_GENESIS`)
		//clamp the byte range to bundle limits
		if (weaveStart < L1WeaveStart) weaveStart = L1WeaveStart
		if (weaveEnd > L1WeaveEnd) weaveEnd = L1WeaveEnd
		dataStart = start - (weaveStart - L1WeaveStart)
	}

	/* final sanity checks */
	if (L1WeaveStart >= CHUNK_ALIGN_GENESIS) {
		if ((weaveStart - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE !== 0n) throw new Error('post-CHUNK_ALIGN_GENESIS weaveStart not on chunk alignment')
		if ((weaveEnd - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE !== 0n) throw new Error('post-CHUNK_ALIGN_GENESIS weaveEnd not on chunk alignment')
	}
	if (weaveStart > weaveEnd) throw new Error('weaveStart cannot be greater than weaveEnd')
	if ((weaveEnd - weaveStart) < BigInt(header0.diSizes[indexTxid])) throw new Error('byte range too small to contain dataItem')
	if (weaveStart < L1WeaveStart) throw new Error('weaveStart out of range')
	// weaveEnd must not run past the grid-aligned end of the L1's last chunk (round L1WeaveEnd up to a chunk boundary)
	const L1WeaveEndAligned = L1WeaveEnd + (CHUNK_SIZE - (L1WeaveEnd - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE) % CHUNK_SIZE
	if (weaveEnd > L1WeaveEndAligned) throw new Error('weaveEnd out of range')
	if (dataStart < 0n) throw new Error('dataStart out of range')

	/* final values */
	if (process.env.NODE_ENV === 'test') console.info('return', { weaveStart, weaveEnd, dataStart, size })
	return {
		start: weaveStart,
		end: weaveEnd,
		dataStart,
		dataSize: size,
	}
}

/* yield node urls for the /offset lookup: fast ingress_nodes first (already
 * shuffled), then the slower http_api_nodes (random-spliced) */
type OffsetNode = { url: string, name: string, throttled?: EpochTimeStamp }
function* hostUrls(): Generator<OffsetNode> {
	for (const node of ingressNodes() as OffsetNode[]) {
		yield node
	}
	const nodes = [...httpApiNodes()] as OffsetNode[]
	while (nodes.length) {
		const iRnd = Math.floor(Math.random() * nodes.length)
		yield nodes.splice(iRnd, 1)[0]
	}
}

const fetchRetryOffset = moize(async (id: string) => {

	for (const node of hostUrls()) {
		if (node.throttled) {
			if (node.throttled - Date.now() > 0) {
				continue
			} else {
				delete node['throttled']
			}
		}

		const url = `${node.url}/tx/${id}/offset`
		let res: Response | undefined
		// per-fetch timeout: /offset is a trivial lookup; a node that doesn't answer
		// quickly is treated as dead so we move on instead of blocking on a hung socket
		// until the OS TCP timeout (which is what created the multi-minute stragglers).
		const ac = new AbortController()
		const timer = setTimeout(() => ac.abort(new Error('offset fetch timeout (5s)')), 10_000)
		try {
			console.info(fetchRetryOffset.name, `unmemoized fetch('${url}')`)
			res = await fetch(url, { signal: ac.signal })

			if (res.status === 429) {
				node.throttled = Date.now() + 30_000
				throw new Error(`HTTP ${res.status} ${res.statusText}`)
			}
			if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

			return await res.json() as { offset: string, size: string }
		} catch (err: unknown) {
			const e = err as Error
			console.error(fetchRetryOffset.name, `${e.name}:${e.message}, fetching byte-range data with '${url}}'. Will retry with another node.`, e.cause)
		} finally {
			clearTimeout(timer)
			if (res?.body && !res.bodyUsed) {
				res.body.cancel()
			}
		}
	}

	/* all nodes exhausted, fallback to GW */

	const url = `${HOST_URL}/tx/${id}/offset`
	console.info(fetchRetryOffset.name, `unmemoized fetch('${url}') fallback`)
	let resFb: Response | undefined
	try {
		resFb = await fetch(url)

		if (!resFb.ok) throw new Error(`HTTP ${resFb.status} ${resFb.statusText}`)

		return await resFb.json() as { offset: string, size: string }
	} catch (e) {
		const { name, message, cause } = e as Error
		console.error(fetchRetryOffset.name, `${name}:${message}, fetching byte-range data with '${url}}'. NOT RETRYING.`, cause)
		throw e;
	} finally {
		if (resFb?.body && !resFb.bodyUsed) {
			resFb.body.cancel()
		}
	}

}, { maxSize: 1000, isPromise: true })

/**
 * Read the real (unpadded) size of the chunk at a given weave offset, via /chunk2.
 * The last 2 chunks of a tx are split into arbitrary sizes by the uploader client, with
 * padding after the real data out to the 256KB boundary - and there is no formula for the
 * split, so we must ask a node. Reuses the /chunk2 fetch (`fetchChunkData`); the node sends
 * the whole chunk regardless, but we resolve from the 3-byte size header and abort the rest.
 * Memoized - tail chunks get re-requested for sibling dataItems in the same bundle.
 */
const chunkSizeAt = moize(async (weaveOffset: bigint): Promise<number> => {
	const nodes = [...httpApiNodes(), ...ingressNodes()]
	for (const node of nodes) {
		const ac = new AbortController()
		const url = `${node.url}/chunk2/${(weaveOffset + 1n).toString()}` // /chunk2 is 1-based
		let size = -1
		const onSize = (s: number) => { size = s; ac.abort() } // got the header, stop reading the body
		try {
			await fetchChunkData('chunkSizeAt', url, ac.signal, () => { }, onSize)
		} catch {
			//aborting in onSize rejects with AbortError - expected once we have the size
		}
		if (size >= 0) return size
		console.error(chunkSizeAt.name, `no size from '${url}'. Trying next node.`)
	}
	throw new Error(`${chunkSizeAt.name}: could not read chunk size at weaveOffset=${weaveOffset}`)
}, { maxSize: 1000, isPromise: true })

