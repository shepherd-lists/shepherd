import { fetchChunkData as fetchChunkDataOriginal } from './chunkFetch'
import http from 'node:http'
import { ReadableStream, ReadableByteStreamController } from 'node:stream/web'
import { httpApiNodes } from '../../libs/utils/update-range-nodes'
import { CHUNK_ALIGN_GENESIS } from '../../libs/byte-ranges/txidToRange/constants-byteRange'
import { ingressNodes } from './ingress-nodes'


/** backend buffered parallel arweave chunk streaming.
 * 
 * stream chunks from nodes starting from chunkStart until dataEnd bytes.
 * - chunkStart: the +1 chunk offset for /chunk2 API
 * - dataEnd: absolute byte position where streaming should stop
 * returns clean data stream that caller can parse/filter as needed.
 * 
 * n.b. filtering the start (i.e. data-items) is done in chunkTxDataStream
 */
export const chunkStream = async (
	chunkStart: bigint,
	dataEnd: number,
	txid: string,
	abortSignal: AbortSignal,
	maxParallel: number = 10,
	fetchChunkData = fetchChunkDataOriginal, //dep inject
): Promise<ReadableStream<Uint8Array>> => {
	let controller: ReadableByteStreamController | null = null
	let activeFetches = 0 //?
	let activeWriteIndex = 0
	let writePos = 0
	let boundaryPos = 0
	let isCancelled = false

	const nodes = [
		...httpApiNodes(),
		...ingressNodes(),
	]
	let nodeIndex = nodes.length - 1

	interface ChunkInfo {
		offset: number
		size?: number
		bufferedData: Uint8Array[] | undefined
		req?: http.ClientRequest
		res?: http.IncomingMessage
		bufferedSize: number
		started?: boolean
	}
	const chunkBuffers: ChunkInfo[] = []

	/** create static chunkInfos in advance for max concurrency */
	if (chunkStart > CHUNK_ALIGN_GENESIS) {
		const CHUNK_SIZE = 262144
		//don't calculate the last 2
		while ((dataEnd - boundaryPos) > CHUNK_SIZE * 2) {
			chunkBuffers.push({
				offset: boundaryPos,
				size: CHUNK_SIZE,
				bufferedData: [],
				bufferedSize: 0,
			})
			boundaryPos += CHUNK_SIZE
		}
		//boundaryPos now points to where dynamic chunks start
	}
	/** ensure starting chunk exists */
	if (chunkBuffers.length === 0) {
		//setup the first chunk only
		chunkBuffers.push({
			offset: 0,
			bufferedData: [],
			bufferedSize: 0,
		})
		//boundaryPos is 0.
	}
	// console.debug({ boundaryPos, chunkBuffers })


	const startChunk = async (index: number, chunkInfo: ChunkInfo) => {
		try {
			if (abortSignal.aborted || isCancelled) return;

			console.info(txid, `chunk ${index}, offset ${chunkInfo.offset} starting...`)


			const onSize = (size: number) => {
				if (isCancelled || abortSignal.aborted) return; //we may be cancelling

				//update current chunk size
				const remaining = dataEnd - chunkInfo.offset
				chunkInfo.size = Math.min(remaining, size)


				const nextOffset = chunkInfo.offset + chunkInfo.size
				//check if we are in dynamic chunkInfo creation range
				if (nextOffset >= boundaryPos) {
					boundaryPos = chunkInfo.offset + chunkInfo.size
					if (nextOffset >= dataEnd) return; //finished creating chunks

					//create next dynamic chunk
					const nextChunkInfo: ChunkInfo = {
						offset: boundaryPos,
						bufferedData: [],
						bufferedSize: 0,
					}
					chunkBuffers.push(nextChunkInfo)

					//start next chunk in parallel 
					if (activeFetches < maxParallel) {
						nextChunkInfo.started = true
						activeFetches++
						startChunk(chunkBuffers.length - 1, nextChunkInfo)
					}
				}
			}


			let chunkPos = chunkInfo.offset

			const onSegment = (segment: Uint8Array) => {
				if (abortSignal.aborted || isCancelled) return;
				if (!controller) throw new Error('controller not found!')

				const remaining = dataEnd - chunkPos
				if (remaining <= 0) return;
				const truncated = remaining < segment.length ? segment.subarray(0, remaining) : segment

				if (index === activeWriteIndex) {
					if (chunkInfo.bufferedData && chunkInfo.bufferedData.length > 0) {
						const l = chunkInfo.bufferedData.reduce((acc, buf) => acc + buf.length, 0)
						console.debug(txid, 'WRITING OUT BUFFERED DATA', l)
						controller.enqueue(new Uint8Array(Buffer.concat(chunkInfo.bufferedData)))
						delete chunkInfo.bufferedData
						writePos += l
					}
					const truncatedLength = truncated.length //need to save before losing buffer 
					controller.enqueue(new Uint8Array(truncated))
					writePos += truncatedLength
					chunkPos += truncatedLength
				} else /** buffering */ {
					if (!chunkInfo.bufferedData) return; //cancelled
					chunkInfo.bufferedData.push(truncated)
					chunkInfo.bufferedSize += truncated.length
					chunkPos += truncated.length
				}
			}

			const onReq = (req: http.ClientRequest, res: http.IncomingMessage) => {
				chunkInfo.req = req
				chunkInfo.res = res
			}

			while (!abortSignal.aborted && !isCancelled) {
				const url = `${nodes[nodeIndex].url}/chunk2/${(chunkStart + BigInt(chunkInfo.offset)).toString()}`
				try {
					await fetchChunkData(txid, url, abortSignal, onSegment, onSize, onReq)
					console.info(txid, `${url} ${chunkInfo.offset}/${dataEnd} bytes ✅ (chunk ${index})`, `DEBUG offset=${chunkInfo.offset},size=${chunkInfo.size},bufferSize=${chunkInfo.bufferedSize}`)
					activeFetches--

					if (isCancelled || abortSignal.aborted) return;

					//start next chunk if we have capacity
					for (let i = 0; i < chunkBuffers.length && activeFetches < maxParallel; i++) {
						const info = chunkBuffers[i]
						if (info.started) continue;
						//avoid race conditions
						info.started = true
						activeFetches++
						startChunk(i, info)
					}

					//move to next chunk(s)
					if (index === activeWriteIndex) {
						console.info(txid, 'index=activeWriteIndex', { index, activeWriteIndex })
						activeWriteIndex++
						//next chunks might be fully buffered already
						while (
							chunkBuffers.length > activeWriteIndex
							&& chunkBuffers[activeWriteIndex].bufferedSize === chunkBuffers[activeWriteIndex].size
						) {
							//enqueue buffer and dataPos+
							const chunkInfo = chunkBuffers[activeWriteIndex]
							const l = chunkInfo.bufferedData!.reduce((acc, buf) => acc + buf.length, 0)
							console.debug(txid, 'WRITING OUT TOTAL BUFFERED DATA', activeWriteIndex, l)
							controller!.enqueue(new Uint8Array(Buffer.concat(chunkInfo.bufferedData!)))
							delete chunkInfo.bufferedData
							writePos += l

							activeWriteIndex++
						}
					}

					//check complete
					if (writePos === dataEnd) {
						console.info(txid, `chunkStream completed: ${writePos}/${dataEnd} bytes`)
						controller?.close()
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
						throw new Error(`${txid} chunkStream: ran out of nodes to try, ${JSON.stringify({ chunkStart: chunkStart.toString(), dataEnd, offset: chunkInfo.offset, lastErrorMsg: (e as Error).message })}`)
					}
					continue;
				}
				finally {
					chunkInfo.req?.destroy()
					chunkInfo.res?.destroy()
				}
			}
		} catch (e) {
			isCancelled = true
			controller?.error(e)

		}
	}//end of startChunk


	return new ReadableStream({
		type: 'bytes',
		start: (c) => {
			controller = c
			//do not pre-load to maxParallel here (might not actually want the stream)
			chunkBuffers[0].started = true
			activeFetches++
			startChunk(0, chunkBuffers[0]) //controller needs to be set. 
		},
		cancel: async () => {
			isCancelled = true
			await Promise.all(
				chunkBuffers.map(info => {
					info.req?.destroy()
					info.res?.destroy()
					delete info.bufferedData
				})
			)
			chunkBuffers.length = 0
		}
	})
}
