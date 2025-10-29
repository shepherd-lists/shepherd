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

	const nodeUrl = 'http://tip-1.arweave.xyz:1984' //fix this later

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

	const startChunk = (index: number, chunkInfo: ChunkInfo) => {
		if (abortSignal.aborted) return

		const url = `${nodeUrl}/chunk2/${(chunkStart + BigInt(chunkInfo.offset)).toString()}`
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

		fetchChunkData(txid, url, abortSignal, onSegment, onSize, onReq)
			.then(() => {
				activeFetches--
				activeWriteIndex++
				// Start next chunk if we have capacity
				if (activeFetches < maxParallel) {
					console.error('TODO: start queued chunks for free slots')
				}
			})
			.catch(error => {
				console.error('TODO: handle errors properly')
				controller?.error(error)
			})

	}

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
