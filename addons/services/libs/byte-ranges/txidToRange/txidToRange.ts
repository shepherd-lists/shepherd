import { CHUNK_ALIGN_GENESIS, CHUNK_SIZE, HOST_URL } from './constants-byteRange'
import moize from 'moize'
import { waitForHost, pauseHost } from '../../utils/rate-limit'
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
	headerLength?: bigint // 0n for L1
}
/** parent & parents are no longer used */
export const txidToRange = async (id: string, parent: string | null, parents: string[] | undefined): Promise<ByteRange> => {
	/**
	 * Overview:
	 * 	HB `raw=` HEAD gives the id's weave offset & size (header-length 0 => L1)
	 * 	L1 (or HB failure with `/tx/{id}/offset` available, e.g. very large L1s) call `/tx/{id}/offset`. end.
	 * 	L2 (ans104, any nesting) read the chunks holding the first & last bytes
	 */
	let hb: Awaited<ReturnType<typeof hbRawHead>>
	for (let attempt = 1; ; attempt++) {
		try {
			hb = await hbRawHead(id)
			break
		} catch (err: unknown) {
			/** a raw= failure says nothing about L1 vs L2: only take the L1 path if the gateway has /offset for the id (404 if not), else retry raw= */
			const e = err as Error
			const url = `${HOST_URL}/tx/${id}/offset`
			await waitForHost(url)
			const isL1 = await fetch(url, { signal: AbortSignal.timeout(10_000) }).then(r => { r.body?.cancel(); return r.ok }, () => false)
			if (isL1) return offsetL1(id)
			if (attempt === 3) throw e
			console.warn(txidToRange.name, `${e.name}:${e.message}. no L1 offset for ${id}, retrying raw= (${attempt}/3)`)
		}
	}
	if (!hb) return {
		status: 404,
		start: -1n, end: -1n,
		dataStart: -1n, dataSize: -1n,
	}
	if (hb.headerLength === 0n) {
		console.log(txidToRange.name, 'L1 detected', id)
		return offsetL1(id)
	}
	return byteRange104(hb.offset, hb.size, hb.headerLength)
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
		headerLength: 0n,
	}
}

const byteRange104 = async (offset: bigint, size: bigint, headerLength: bigint): Promise<ByteRange> => {

	/* the chunks holding the dataItem's first & last bytes. a chunk may be smaller than its 256KB bucket (last 2 chunks of a tx) */

	const first = await chunkAt(offset)
	const last = offset + size <= first.absEnd ? first : await chunkAt(offset + size - 1n)

	const chunkStart = first.absEnd - first.size
	const dataStart = offset - chunkStart
	let weaveStart = chunkStart
	let weaveEnd = last.absEnd

	/* post-CHUNK_ALIGN_GENESIS: expand to the chunks' 256KB buckets */
	if (chunkStart >= CHUNK_ALIGN_GENESIS) {
		weaveStart = first.absEnd + (CHUNK_SIZE - (first.absEnd - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE) % CHUNK_SIZE - CHUNK_SIZE
		weaveEnd = last.absEnd + (CHUNK_SIZE - (last.absEnd - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE) % CHUNK_SIZE
	}

	/* final sanity checks */
	if (weaveStart > weaveEnd) throw new Error('weaveStart cannot be greater than weaveEnd')
	if ((weaveEnd - weaveStart) < size) throw new Error('byte range too small to contain dataItem')
	if (dataStart < 0n) throw new Error('dataStart out of range')

	if (process.env.NODE_ENV === 'test') console.info('return', { offset, size, first, last, weaveStart, weaveEnd, dataStart })
	return {
		start: weaveStart,
		end: weaveEnd,
		dataStart,
		dataSize: size,
		headerLength,
	}
}

/** HyperBEAM gives the weave offset & sizes of L1s and ans104 dataItems (any nesting). null if not found */
const hbRawHead = moize(async (id: string) => {
	// method=HEAD: the CDN forwards HEAD upstream as a full GET (reads the whole item); this keeps HB on its head path
	const url = `${HOST_URL}/~arweave@2.9/raw=${id}?method=HEAD`
	console.info(hbRawHead.name, `unmemoized fetch('${url}')`)
	// identity: a gzip-encoded response drops content-length. 429s pause every request to the host, then retry indefinitely
	let res: Response
	let attempt = 0
	while (true) {
		await waitForHost(url)
		res = await fetch(url, { method: 'HEAD', headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(10_000) })
		if (res.status !== 429) break
		const wait = pauseHost(url, res.headers.get('retry-after'), attempt++)
		console.warn(hbRawHead.name, `429 for ${id}. pausing all requests to ${new URL(url).host} for ${wait}s`)
	}
	if (res.status === 404) return null
	if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`)

	const offset = res.headers.get('offset')
	const headerLength = res.headers.get('header-length')
	const contentLength = res.headers.get('data-length') ?? res.headers.get('content-length')
	if (!offset || !headerLength || !contentLength) throw new Error(`missing offset/header-length/data-length headers for ${url}`)

	return {
		offset: BigInt(offset),
		size: BigInt(headerLength) + BigInt(contentLength),
		headerLength: BigInt(headerLength),
	}
}, { maxSize: 1000, isPromise: true })

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
		let attempt = 0
		while (true) {
			await waitForHost(url)
			resFb = await fetch(url)
			if (resFb.status !== 429) break
			const wait = pauseHost(url, resFb.headers.get('retry-after'), attempt++)
			console.warn(fetchRetryOffset.name, `429 for ${url}. pausing all requests to ${new URL(url).host} for ${wait}s`)
			await resFb.body?.cancel()
		}

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
 * Read the real (unpadded) size and absolute end offset of the chunk holding a given weave offset, via /chunk2.
 * The last 2 chunks of a tx are split into arbitrary sizes by the uploader client, with
 * padding after the real data out to the 256KB boundary - and there is no formula for the
 * split, so we must ask a node. Reuses the /chunk2 fetch (`fetchChunkData`); the node sends
 * the whole chunk regardless, but we resolve from the `arweave-absolute-end-offset` response
 * header and the 3-byte size header, then abort the rest.
 */
const chunkAt = moize(async (weaveOffset: bigint): Promise<{ absEnd: bigint, size: bigint }> => {
	const nodes = [...ingressNodes(), ...httpApiNodes()]
	for (const node of nodes) {
		const ac = new AbortController()
		const url = `${node.url}/chunk2/${(weaveOffset + 1n).toString()}` // /chunk2 is 1-based
		let size = -1
		let absEnd: string | undefined
		let response: { complete: boolean } | undefined
		// got the header, stop reading the body. not if complete: aborting then errors the pooled keep-alive socket (uncaught)
		const onSize = (s: number) => { size = s; if (!response?.complete) ac.abort() }
		try {
			await fetchChunkData('chunkAt', url, ac.signal, () => { }, onSize, (_, res) => { response = res; absEnd = res.headers['arweave-absolute-end-offset'] as string })
		} catch {
			//aborting in onSize rejects with AbortError - expected once we have the size
		}
		if (size >= 0 && absEnd) return { absEnd: BigInt(absEnd), size: BigInt(size) }
		console.error(chunkAt.name, `no size/absolute-end-offset from '${url}'. Trying next node.`)
	}
	throw new Error(`${chunkAt.name}: could not read chunk at weaveOffset=${weaveOffset}`)
}, { maxSize: 1000, isPromise: true })

