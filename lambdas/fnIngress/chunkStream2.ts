import { fetchChunkData } from './chunkStream'
import http from 'node:http'
import { ReadableStream, ReadableByteStreamController } from 'node:stream/web'
import { httpApiNodes } from '../../libs/utils/update-range-nodes'


/** real buffered parallel chunk streaming */
export const chunkStream2 = async (
	chunkStart: bigint,
	dataEnd: number,
	txid: string,
	abortSignal: AbortSignal,
	maxParallel: number = 10
): Promise<ReadableStream<Uint8Array>> => {
	let controller: ReadableByteStreamController | null = null
	let activeFetches = 0 //?
	let activeWriteIndex = 0
	let dataPos = 0
	let boundaryPos = 0

	const nodes = [
		...httpApiNodes(),
		//manually adding these for now
		{ url: 'http://tip-2.arweave.xyz:1984', name: 'tip-2.arweave.xyz' },
		{ url: 'http://tip-3.arweave.xyz:1984', name: 'tip-3.arweave.xyz' },
		{ url: 'http://tip-4.arweave.xyz:1984', name: 'tip-4.arweave.xyz' },
	]
	let nodeIndex = nodes.length - 1


	interface ChunkInfo {
		offset: number
		bufferedData: Uint8Array[] | undefined
		req?: http.ClientRequest
		res?: http.IncomingMessage
		fullyBuffered: boolean
	}
	const chunkBuffers: ChunkInfo[] = []

	/** this function will always be called in sequence */
	const onSize = (size: number) => {
		//check if we're done setting up chunk fetches
		if (boundaryPos > dataEnd) return console.debug('boundaryPos exceeds dataEnd')
		boundaryPos += size

		//set up next chunk
		const nextChunkInfo: ChunkInfo = {
			offset: boundaryPos,
			bufferedData: [],
			fullyBuffered: false,
		}
		chunkBuffers.push(nextChunkInfo)

		//start next chunk in parallel
		if (activeFetches < maxParallel) {
			startChunk(chunkBuffers.length - 1, nextChunkInfo)
		}
	}

	const startChunk = async (index: number, chunkInfo: ChunkInfo) => {
		if (abortSignal.aborted) return
		console.info(txid, `chunk ${index}, offset ${chunkInfo.offset} starting...`)

		activeFetches++

		const onSegment = (segment: Uint8Array) => {
			if (abortSignal.aborted || !controller) return

			if (index === activeWriteIndex) {
				if (chunkInfo.bufferedData && chunkInfo.bufferedData.length > 0) {
					const l = chunkInfo.bufferedData.length
					controller.enqueue(new Uint8Array(Buffer.concat(chunkInfo.bufferedData)))
					delete chunkInfo.bufferedData
					dataPos += l
				}
				const ls = segment.length
				controller.enqueue(new Uint8Array(segment))
				dataPos += ls
			} else /** buffering */ {
				chunkInfo.bufferedData!.push(segment)
			}
		}

		const onReq = (req: http.ClientRequest, res: http.IncomingMessage) => {
			chunkInfo.req = req
			chunkInfo.res = res
		}

		while (!abortSignal.aborted) {
			const url = `${nodes[nodeIndex].url}/chunk2/${(chunkStart + BigInt(chunkInfo.offset)).toString()}`
			try {
				await fetchChunkData(txid, url, abortSignal, onSegment, onSize, onReq)
				console.info(txid, `${url} ${chunkInfo.offset}/${dataEnd} bytes ✅ (chunk ${activeWriteIndex})`)
				activeFetches--
				activeWriteIndex++
				// Start next chunk if we have capacity
				if (activeFetches < maxParallel) {
					console.error('TODO: start queued chunks for free slots')
				}
				return;
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					console.info(txid, `chunkStream aborted. reason: ${abortSignal?.reason ?? 'aborted'}`)
					controller?.error(new Error(abortSignal?.reason ?? 'aborted'))
					return;
				}

				console.error(txid, url, `${String(e)}, ${chunkInfo.offset}/${dataEnd} bytes. trying next node`)
				nodeIndex--

				if (nodeIndex < 0) {
					throw new Error(`chunkStream: ran out of nodes to try, ${JSON.stringify({ chunkStart: chunkStart.toString(), dataEnd, offset: chunkInfo.offset, lastErrorMsg: (e as Error).message })}`)
				}
				continue;
			}
			finally {
				chunkInfo.req?.destroy()
				chunkInfo.res?.destroy()
			}
		}

	}//end of startChunk

	// Start first chunk
	chunkBuffers.push({
		offset: 0,
		bufferedData: [],
		fullyBuffered: false,
	})
	startChunk(0, chunkBuffers[0])

	return new ReadableStream({
		type: 'bytes',
		start: (c) => { controller = c },
		cancel: () => {
			abortSignal.dispatchEvent(new Event('abort')) //?
			activeFetches = 0
			//TODO: cancel all req/res fetches and release buffers
		}
	})
}
