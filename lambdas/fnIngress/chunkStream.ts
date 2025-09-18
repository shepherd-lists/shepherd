import http from 'node:http'
import { httpApiNodes } from '../../libs/utils/update-range-nodes'
import { ReadableStream } from 'node:stream/web'



const agent = new http.Agent({
	keepAlive: true,
	maxSockets: 100,
	maxFreeSockets: 5,
	timeout: 30_000
})

export const destroyChunkStreamAgent = () => agent.destroy()

/**
 * stream chunks from nodes starting from chunkStart until dataEnd bytes.
 * - chunkStart: the +1 chunk offset for /chunk2 API
 * - dataEnd: absolute byte position where streaming should stop
 * returns clean data stream that caller can parse/filter as needed.
 */
export async function chunkStream(chunkStart: bigint, dataEnd: number, txid: string): Promise<ReadableStream<Uint8Array>> {
	const nodes = [
		...httpApiNodes(),
		//manually adding these for now
		{ url: 'http://tip-2.arweave.xyz:1984', name: 'tip-2.arweave.xyz' },
		{ url: 'http://tip-4.arweave.xyz:1984', name: 'tip-4.arweave.xyz' },
		{ url: 'http://tip-3.arweave.xyz:1984', name: 'tip-3.arweave.xyz' },
	]
	let node = nodes.pop()

	let cancelled = false
	let currentReq: http.ClientRequest | null = null
	let currentRes: http.IncomingMessage | null = null
	let lastErrorMsg = ''

	const stream = new ReadableStream({
		type: 'bytes',
		start(controller) {
			let bytePos = 0 //bytes fetched so far
			let totalChunksProcessed = 0 //total chunks processed across all phases
			console.log(txid, `chunkStream starting: chunkStart=${chunkStart}, dataEnd=${dataEnd}, nodes=${nodes.length}`)

			const fetchNext = async (): Promise<void> => {
				const PARALLEL_CONCURRENCY = 10

				// Phase 1: Fetch first 2 chunks individually for file type detection
				if (!cancelled && bytePos < dataEnd) {
					const result1 = await fetchChunks([bytePos])
					bytePos = result1.newBytePos
					totalChunksProcessed += result1.chunksProcessed
				}

				if (!cancelled && bytePos < dataEnd) {
					const result2 = await fetchChunks([bytePos])
					bytePos = result2.newBytePos
					totalChunksProcessed += result2.chunksProcessed
				}

				// Phase 2: Fetch remaining chunks in parallel batches
				while (!cancelled && bytePos < dataEnd) {
					const remainingBytes = dataEnd - bytePos
					const chunkSize = 262_144 // 256KB
					const remainingChunks = Math.ceil(remainingBytes / chunkSize)
					const batchSize = Math.min(PARALLEL_CONCURRENCY, remainingChunks)

					if (batchSize === 0) break

					// Create array of chunk offsets for this batch
					const chunkOffsets = []
					for (let i = 0; i < batchSize; i++) {
						const offset = bytePos + (i * chunkSize)
						if (offset >= dataEnd) break
						chunkOffsets.push(offset)
					}

					const batchResult = await fetchChunks(chunkOffsets)
					bytePos = batchResult.newBytePos
					totalChunksProcessed += batchResult.chunksProcessed
				}

				// Verify all expected bytes were fetched before closing
				if (bytePos < dataEnd) {
					console.error(txid, `chunkStream incomplete: ${bytePos}/${dataEnd} bytes fetched`)
					return controller.error(new Error(`Incomplete download: ${bytePos}/${dataEnd} bytes`))
				}

				console.info(txid, `chunkStream completed successfully: ${bytePos}/${dataEnd} bytes, ${totalChunksProcessed} chunks`)
				controller.close()
			}

			const fetchChunks = async (chunkOffsets: number[]): Promise<{ newBytePos: number, chunksProcessed: number }> => {
				if (!node) {
					throw new Error(`chunkStream: ran out of nodes to try, ${JSON.stringify({ chunkStart: chunkStart.toString(), dataEnd, bytePos: chunkOffsets[0] || 0, lastErrorMsg })}`)
				}

				console.info(txid, `Fetching ${chunkOffsets.length} chunks from offset ${chunkOffsets[0]}`)

				// For sequential (single chunk), stream directly as data arrives
				if (chunkOffsets.length === 1) {
					const offset = chunkOffsets[0]
					let currentPos = offset
					let processed = 0

					const url = `${node.url}/chunk2/${(chunkStart + BigInt(offset)).toString()}`
					try {
						await fetchChunkData(txid, url, (segment) => {
							if (cancelled) return
							const remaining = dataEnd - currentPos
							if (remaining <= 0) return

							const truncated = remaining < segment.length ? segment.subarray(0, remaining) : segment
							const truncatedLength = truncated.length // Save length before enqueue!
							controller.enqueue(truncated)
							currentPos += truncatedLength
						}, (req, res) => {
							currentReq = req
							currentRes = res
						})
						processed++
						console.info(txid, `${url} ${currentPos}/${dataEnd} bytes ✅ (chunk ${totalChunksProcessed + processed})`)
						return { newBytePos: currentPos, chunksProcessed: processed }
					} catch (e) {
						console.error(txid, `${String(e)}, ${currentPos}/${dataEnd} bytes. trying next node`)
						lastErrorMsg = (e as Error).message
						node = nodes.pop()
						if (!node) {
							throw new Error(`${txid} chunkStream: ran out of nodes to try, ${JSON.stringify({ chunkStart: chunkStart.toString(), dataEnd, bytePos: currentPos, lastErrorMsg })}`)
						}
						if (cancelled) throw e
						return fetchChunks(chunkOffsets) // Retry with new node
					} finally {
						currentReq?.destroy()
						currentRes?.destroy()
						currentReq = null
						currentRes = null
					}
				}

				// For parallel chunks, use ordered streaming buffer
				const chunkBuffer = new Map<number, Uint8Array>() // offset -> data
				let nextExpectedOffset = chunkOffsets[0]
				let totalBytesStreamed = 0
				let processed = 0
				let remainingChunks = new Set(chunkOffsets)

				const streamBufferedChunks = () => {
					while (chunkBuffer.has(nextExpectedOffset) && !cancelled) {
						const chunkData = chunkBuffer.get(nextExpectedOffset)!
						chunkBuffer.delete(nextExpectedOffset)
						remainingChunks.delete(nextExpectedOffset)

						const remaining = dataEnd - nextExpectedOffset
						const truncated = remaining < chunkData.length ? chunkData.subarray(0, remaining) : chunkData
						if (truncated.length > 0) {
							const truncatedLength = truncated.length // Save length before enqueue!
							controller.enqueue(truncated)
							totalBytesStreamed += truncatedLength
							processed++
							console.info(txid, `Streamed chunk at ${nextExpectedOffset}: ${nextExpectedOffset + truncatedLength}/${dataEnd} bytes ✅ (chunk ${totalChunksProcessed + processed})`)
						}

						nextExpectedOffset += 262_144 // Move to next expected chunk
					}
				}

				// Start all chunk fetches in parallel
				const promises = chunkOffsets.map(async (offset) => {
					try {
						const result = await fetchSingleChunk(offset)
						if (result.success && result.data) {
							chunkBuffer.set(offset, result.data)
							streamBufferedChunks() // Try to stream chunks in order
							return { offset, success: true }
						} else {
							return { offset, success: false }
						}
					} catch (e) {
						console.error(txid, `Chunk fetch failed for offset ${offset}: ${e}`)
						return { offset, success: false }
					}
				})

				try {
					const results = await Promise.all(promises)
					const failedOffsets = results.filter(r => !r.success).map(r => r.offset)

					// Retry failed chunks
					for (const failedOffset of failedOffsets) {
						if (cancelled) break
						if (!remainingChunks.has(failedOffset)) continue // Already streamed

						const retryResult = await retryChunk(failedOffset, 3)
						if (retryResult) {
							chunkBuffer.set(failedOffset, retryResult)
							streamBufferedChunks() // Try to stream again
						} else {
							console.error(txid, `All retries failed for chunk at offset ${failedOffset}`)
						}
					}

					// Calculate new position - advance to end of the batch
					const batchEndOffset = Math.max(...chunkOffsets) + 262_144
					const newBytePos = Math.min(batchEndOffset, dataEnd)

					return { newBytePos, chunksProcessed: processed }
				} catch (e) {
					console.error(txid, `Batch failed, switching to next node: ${e}`)
					lastErrorMsg = (e as Error).message
					node = nodes.pop()
					if (!node) {
						throw new Error(`${txid} All nodes exhausted: ${lastErrorMsg}`)
					}
					return fetchChunks(chunkOffsets) // Retry with new node
				}
			}

			const fetchSingleChunk = async (offset: number): Promise<{ success: boolean, data?: Uint8Array, url: string }> => {
				if (!node) return { success: false, url: '' }

				const url = `${node.url}/chunk2/${(chunkStart + BigInt(offset)).toString()}`
				const chunks: Uint8Array[] = []
				let req: http.ClientRequest | undefined
				let res: http.IncomingMessage | undefined

				try {
					await fetchChunkData(txid, url, (segment) => chunks.push(segment), (r, rs) => { req = r; res = rs })

					const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
					const combined = new Uint8Array(totalLength)
					let pos = 0
					for (const chunk of chunks) {
						combined.set(chunk, pos)
						pos += chunk.length
					}
					return { success: true, data: combined, url }
				} catch (e) {
					lastErrorMsg = (e as Error).message
					console.error(txid, `Chunk fetch failed for offset ${offset}: ${lastErrorMsg}`)
					return { success: false, url }
				} finally {
					req?.destroy()
					res?.destroy()
				}
			}

			const retryChunk = async (offset: number, maxRetries: number): Promise<Uint8Array | null> => {
				for (let attempt = 1; attempt <= maxRetries; attempt++) {
					console.info(txid, `Retrying chunk at offset ${offset}, attempt ${attempt}/${maxRetries}`)

					if (attempt > 1) {
						await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 2)))
					}

					const result = await fetchSingleChunk(offset)
					if (result.success && result.data) {
						return result.data
					}
				}
				return null
			}

			fetchNext().catch(e => controller.error(e))
		},
		cancel(reason) {
			cancelled = true
			if (currentRes) currentRes.destroy()
			if (currentReq) currentReq.destroy()
			console.info(txid, `chunkStream cancelled. reason: ${reason}`)
		},
	})

	return stream
}

/**
 * Fetch a single /chunk2 response and emit all chunk payload bytes.
 * Returns the chunk size that was processed. 
 * N.B. this is uncancellable because:
 *  the chunk usually downloads too quickly to cancel.
 *  the arweave node is unaffected as it will process request regardless of request/connection status. it's nothing to them.
 */
function fetchChunkData(
	txid: string,
	url: string,
	onSegment: (segment: Uint8Array) => void,
	onReq?: (req: http.ClientRequest, res: http.IncomingMessage) => void,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const timeout = (message: string) => {
			req.destroy()
			reject(new Error(`${txid} ${message}: ${url}`))
		}

		const req = http.get(url, { agent, headers: { 'x-packing': 'unpacked' } }, (res) => {
			if (res.statusCode !== 200) {
				res.destroy()
				return reject(new Error(`${txid} ${url} failed: ${res.statusCode} ${res.statusMessage}`))
			}

			res.setTimeout(30_000, () => timeout('Response timeout after 30s'))
			onReq?.(req, res)

			const headerBuf = new Uint8Array(3)
			let headerOffset = 0
			let chunkSize = -1
			let bytesEmitted = 0

			const processData = (buf: Buffer) => {
				let offset = 0

				// Read 3-byte header if not complete
				while (offset < buf.length && chunkSize < 0) {
					const remaining = 3 - headerOffset
					const available = buf.length - offset
					const toCopy = Math.min(remaining, available)

					headerBuf.set(buf.subarray(offset, offset + toCopy), headerOffset)
					headerOffset += toCopy
					offset += toCopy

					if (headerOffset === 3) {
						chunkSize = (headerBuf[0] << 16) | (headerBuf[1] << 8) | headerBuf[2]
					}
				}

				// Emit chunk data
				if (chunkSize > 0 && offset < buf.length) {
					const remaining = chunkSize - bytesEmitted
					const available = buf.length - offset
					const toEmit = Math.min(remaining, available)

					onSegment(new Uint8Array(buf.subarray(offset, offset + toEmit)))
					bytesEmitted += toEmit

					if (bytesEmitted === chunkSize) {
						res.removeAllListeners('data')
						res.on('data', () => { }) // drain without processing
						res.resume()
					}
				}
			}

			res.on('data', processData)
			res.on('end', () => {
				chunkSize > 0 ? resolve(chunkSize) : reject(new Error(`${txid} Connection ended before chunk header was fully read`))
			})
		})

		req.setTimeout(30_000, () => timeout('Request timeout after 30s'))
		req.on('error', reject)
	})
}

