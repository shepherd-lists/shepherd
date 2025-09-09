import http from 'node:http'
import { httpApiNodes } from '../../libs/utils/update-range-nodes'
import { ReadableStream } from 'node:stream/web'



const agent = new http.Agent({
	keepAlive: true,
	maxSockets: 50,
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
export async function chunkStream(chunkStart: bigint, dataEnd: number): Promise<ReadableStream<Uint8Array>> {
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
			console.log(`chunkStream starting: chunkStart=${chunkStart}, dataEnd=${dataEnd}, nodes=${nodes.length}`)

			const fetchNext = async (): Promise<void> => {
				const INITIAL_CHUNKS = 2 // Fetch first 2 chunks sequentially for file type detection
				const PARALLEL_CONCURRENCY = 10 // Then fetch remaining chunks in parallel

				// Phase 1: Fetch first 2 chunks sequentially
				let chunksProcessed = 0
				while (!cancelled && bytePos < dataEnd && chunksProcessed < INITIAL_CHUNKS) {
					if (!node) {
						return controller.error(
							new Error(`chunkStream: ran out of nodes to try, ${JSON.stringify({ chunkStart: chunkStart.toString(), dataEnd, bytePos, lastErrorMsg })}`)
						)
					}

					const url = `${node.url}/chunk2/${(chunkStart + BigInt(bytePos)).toString()}`
					try {
						const size = await fetchChunkData(url, (segment) => {
							//truncate segment if it would exceed dataEnd
							const remaining = dataEnd - bytePos
							if (remaining <= 0) return //already at limit

							const truncated = remaining < segment.length
								? segment.subarray(0, remaining)
								: segment

							//n.b. control of our segment is given away after enqueuing a byte stream
							const truncatedLength = truncated.length //<= very important to store this before enqueuing
							controller.enqueue(truncated)
							bytePos += truncatedLength
						}, (req, res) => {
							currentReq = req
							currentRes = res
						})
						console.info(`${url} ${bytePos}/${dataEnd} bytes ✅ (initial chunk ${chunksProcessed + 1}/2)`)
						chunksProcessed++
					} catch (e) {
						console.error(`${String(e)}, ${bytePos}/${dataEnd} bytes. trying next node`)
						lastErrorMsg = (e as Error).message
						node = nodes.pop()
						if (cancelled) return
						continue
					} finally {
						currentReq?.destroy()
						currentRes?.destroy()
						currentReq = null
						currentRes = null
					}
				}

				// Phase 2: Fetch remaining chunks in parallel batches
				while (!cancelled && bytePos < dataEnd) {
					const remainingBytes = dataEnd - bytePos
					const chunkSize = 256 * 1024 // 256KB
					const remainingChunks = Math.ceil(remainingBytes / chunkSize)
					const batchSize = Math.min(PARALLEL_CONCURRENCY, remainingChunks)

					if (batchSize === 0) break

					console.info(`Starting parallel batch: ${batchSize} chunks from offset ${bytePos}`)

					const chunkPromises = []
					for (let i = 0; i < batchSize; i++) {
						const chunkOffset = bytePos + (i * chunkSize)
						if (chunkOffset >= dataEnd) break

						chunkPromises.push(fetchChunkAtOffset(chunkOffset, node))
					}

					try {
						const chunkResults = await Promise.all(chunkPromises)

						// Process results in order and advance bytePos
						for (const result of chunkResults) {
							if (result) {
								const remaining = dataEnd - bytePos
								const truncated = remaining < result.length ? result.subarray(0, remaining) : result
								const truncatedLength = truncated.length
								controller.enqueue(truncated)
								bytePos += truncatedLength
							}
						}

						console.info(`Parallel batch completed: ${chunkResults.length}/${batchSize} chunks, now at ${bytePos}/${dataEnd} bytes`)

					} catch (e) {
						console.error(`Parallel batch failed, switching to next node: ${e}`)
						node = nodes.pop()
						if (!node) {
							return controller.error(new Error('All nodes exhausted during parallel fetch'))
						}
						console.info(`Switching to next node for parallel fetch: ${node.name}`)
						// Retry this batch with new node by not advancing bytePos
						continue
					}
				}

				if (!cancelled) controller.close()
			}

			const fetchChunkAtOffset = async (offset: number, currentNode: typeof node): Promise<Uint8Array | null> => {
				if (!currentNode) return null

				const url = `${currentNode.url}/chunk2/${(chunkStart + BigInt(offset)).toString()}`
				const chunks: Uint8Array[] = []
				let chunkReq: http.ClientRequest | undefined
				let chunkRes: http.IncomingMessage | undefined

				try {
					await fetchChunkData(url, (segment) => {
						chunks.push(segment)
					}, (req, res) => {
						chunkReq = req
						chunkRes = res
					})

					// Combine all segments into single array
					const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
					const combined = new Uint8Array(totalLength)
					let pos = 0
					for (const chunk of chunks) {
						combined.set(chunk, pos)
						pos += chunk.length
					}
					return combined
				} catch (e) {
					console.error(`Parallel chunk fetch failed for offset ${offset}: ${e}`)
					return null
				} finally {
					// Always cleanup connections for parallel requests
					chunkReq?.destroy()
					chunkRes?.destroy()
				}
			}

			fetchNext().catch(e => controller.error(e))
		},
		cancel(reason) {
			cancelled = true
			if (currentRes) currentRes.destroy()
			if (currentReq) currentReq.destroy()
			console.info(`chunkStream cancelled. reason: ${reason}`)
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
	url: string,
	onSegment: (segment: Uint8Array) => void,
	onReq?: (req: http.ClientRequest, res: http.IncomingMessage) => void,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = http.get(url, { agent, headers: { 'x-packing': 'unpacked' } }, (res) => {
			if (res.statusCode !== 200) {
				res.destroy()
				return reject(new Error(`${url} failed: ${res.statusCode} ${res.statusMessage}`, { cause: res }))
			}

			// Set timeout on the response
			res.setTimeout(30_000, () => {
				res.destroy()
				reject(new Error(`Response timeout after 30s: ${url}`))
			})

			if (onReq) onReq(req, res)

			let headerBytesNeeded = 3
			let headerBuf = new Uint8Array(3)
			let headerOffset = 0
			let chunkSize = -1
			let emitted = 0

			res.on('data', (buf: Buffer) => {
				let offset = 0
				while (offset < buf.length) {
					if (chunkSize < 0) {
						//read 3-byte big-endian length prefix
						const toCopy = Math.min(headerBytesNeeded, buf.length - offset)
						headerBuf.set(buf.subarray(offset, offset + toCopy), headerOffset)
						headerOffset += toCopy
						offset += toCopy
						headerBytesNeeded -= toCopy
						if (headerBytesNeeded === 0) {
							chunkSize = (headerBuf[0] << 16) | (headerBuf[1] << 8) | headerBuf[2] //cpu endian agnostic
						}
						continue
					}

					const remainingChunk = chunkSize - emitted
					const toTake = Math.min(remainingChunk, buf.length - offset)
					const slice = buf.subarray(offset, offset + toTake)

					// emit all chunk data - let caller handle filtering
					onSegment(new Uint8Array(slice))

					emitted += toTake
					offset += toTake

					if (emitted === chunkSize) {
						// res.removeAllListeners('data')
						// res.removeAllListeners('end')
						res.destroy()
						return resolve(chunkSize)
					}
				}
			})

			res.on('end', () => {
				if (chunkSize > 0) return resolve(chunkSize)
				reject(new Error('Connection ended before chunk header was fully read'))
			})
		})

		// Add explicit request timeout to catch network-level hangs in Lambda
		req.setTimeout(30_000, () => {
			req.destroy()
			reject(new Error(`Request timeout after 30s: ${url}`))
		})

		req.on('error', reject)
	})
}

