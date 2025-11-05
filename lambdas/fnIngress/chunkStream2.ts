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
	let isCancelled = false

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
		size?: number
		bufferedData: Uint8Array[] | undefined
		req?: http.ClientRequest
		res?: http.IncomingMessage
		bufferedSize: number
	}
	const chunkBuffers: ChunkInfo[] = []

	/** this function will always be called in sequence */
	const onSize = (size: number) => {
		//check if we're done setting up chunk fetches
		boundaryPos += size
		if (dataEnd - boundaryPos <= 0) {
			// console.debug('SETUP ENOUGH CHUNKS')
			return;
		}
		// console.debug('DEBUG', { size, dataEnd, boundaryPos, remaining: dataEnd - boundaryPos })

		//update current chunk
		if (isCancelled) return; //we may be cancelling
		chunkBuffers[chunkBuffers.length - 1].size = size

		//set up next chunk
		const nextChunkInfo: ChunkInfo = {
			offset: boundaryPos,
			bufferedData: [],
			bufferedSize: 0,
		}
		chunkBuffers.push(nextChunkInfo)

		//start next chunk in parallel
		if (activeFetches < maxParallel) {
			startChunk(chunkBuffers.length - 1, nextChunkInfo)
		}
	}

	const startChunk = async (index: number, chunkInfo: ChunkInfo) => {
		try {
			if (abortSignal.aborted) return
			console.info(txid, `chunk ${index}, offset ${chunkInfo.offset} starting...`)

			activeFetches++

			const onSegment = (segment: Uint8Array) => {
				if (abortSignal.aborted || isCancelled) return;
				if (!controller) throw new Error('controller not found!')

				const remaining = dataEnd - dataPos
				if (remaining <= 0) return;
				const truncated = remaining < segment.length ? segment.subarray(0, remaining) : segment

				if (index === activeWriteIndex) {
					if (chunkInfo.bufferedData && chunkInfo.bufferedData.length > 0) {
						const l = chunkInfo.bufferedData.reduce((acc, buf) => acc + buf.length, 0)
						console.debug('WRITING OUT BUFFERED DATA', l)
						controller.enqueue(new Uint8Array(Buffer.concat(chunkInfo.bufferedData)))
						delete chunkInfo.bufferedData
						dataPos += l
					}
					const truncatedLength = truncated.length //need to save before losing buffer 
					controller.enqueue(new Uint8Array(truncated))
					dataPos += truncatedLength
				} else /** buffering */ {
					chunkInfo.bufferedData!.push(truncated)
					chunkInfo.bufferedSize += truncated.length
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
					console.info(txid, `${url} ${chunkInfo.offset}/${dataEnd} bytes ✅ (chunk ${index})`, `DEBUG dataPos ${dataPos}`)
					activeFetches--
					if (index === activeWriteIndex) {
						console.info('index=activeWriteIndex', { index, activeWriteIndex })
						activeWriteIndex++
						//next chunks might be fully buffered already
						while (
							chunkBuffers.length > activeWriteIndex
							&& chunkBuffers[activeWriteIndex].bufferedSize === chunkBuffers[activeWriteIndex].size
						) {
							//enqueue buffer and dataPos+
							const chunkInfo = chunkBuffers[activeWriteIndex]
							const l = chunkInfo.bufferedData!.reduce((acc, buf) => acc + buf.length, 0)
							console.debug('WRITING OUT TOTAL BUFFERED DATA', activeWriteIndex, l)
							controller!.enqueue(new Uint8Array(Buffer.concat(chunkInfo.bufferedData!)))
							delete chunkInfo.bufferedData
							dataPos += l

							activeWriteIndex++
						}
					}


					// Start next chunk if we have capacity
					if (activeFetches < maxParallel) {
						console.error('TODO: start queued chunks for free slots')
					}
					//if we have streamed all data close the controller
					if (dataPos === dataEnd) {
						console.info(txid, `chunkStream2 completed: ${dataPos}/${dataEnd} bytes`)
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
						throw new Error(`chunkStream: ran out of nodes to try, ${JSON.stringify({ chunkStart: chunkStart.toString(), dataEnd, offset: chunkInfo.offset, lastErrorMsg: (e as Error).message })}`)
					}
					continue;
				}
				finally {
					chunkInfo.req?.destroy()
					chunkInfo.res?.destroy()
				}
			}
		} catch (e) {
			controller?.error(e)
		}
	}//end of startChunk

	// Start first chunk
	chunkBuffers.push({
		offset: 0,
		bufferedData: [],
		bufferedSize: 0,
	})

	return new ReadableStream({
		type: 'bytes',
		start: (c) => {
			controller = c
			startChunk(0, chunkBuffers[0]) //controller needs to be set before this
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
