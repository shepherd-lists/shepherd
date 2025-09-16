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
			let totalChunksProcessed = 0 //total chunks processed across all phases
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
						totalChunksProcessed++
						console.info(`${url} ${bytePos}/${dataEnd} bytes ✅ (chunk ${totalChunksProcessed})`)
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
					const chunkSize = 262_144 // 256KB
					const remainingChunks = Math.ceil(remainingBytes / chunkSize)
					const batchSize = Math.min(PARALLEL_CONCURRENCY, remainingChunks)

					if (batchSize === 0) break

					console.info(`Starting parallel batch: ${batchSize} chunks from offset ${bytePos}`)

					const chunkPromises = []
					const chunkMetadata = []
					for (let i = 0; i < batchSize; i++) {
						const chunkOffset = bytePos + (i * chunkSize)
						if (chunkOffset >= dataEnd) break

						const chunkMeta = {
							offset: chunkOffset,
							url: `${node?.url}/chunk2/${(chunkStart + BigInt(chunkOffset)).toString()}`,
							index: i
						}
						chunkMetadata.push(chunkMeta)
						chunkPromises.push(fetchChunkAtOffset(chunkOffset, node))
					}

					try {
						const chunkResults = await Promise.all(chunkPromises)

						// Process results in order and advance bytePos
						for (let i = 0; i < chunkResults.length; i++) {
							const result = chunkResults[i]
							const meta = chunkMetadata[i]

							if (result) {
								const remaining = dataEnd - bytePos
								const truncated = remaining < result.length ? result.subarray(0, remaining) : result
								const truncatedLength = truncated.length
								controller.enqueue(truncated)
								bytePos += truncatedLength
								totalChunksProcessed++
								console.info(`${meta.url} ${bytePos}/${dataEnd} bytes ✅ (chunk ${totalChunksProcessed})`)
							} else {
								console.error(`${meta.url} failed ❌`)
							}
						}

						console.info(`Parallel batch completed: ${chunkResults.length}/${batchSize} chunks, now at ${bytePos}/${dataEnd} bytes`)

					} catch (e) {
						lastErrorMsg = (e as Error).message
						console.error(`Parallel batch failed, switching to next node: ${e}`)
						node = nodes.pop()
						if (!node) {
							return controller.error(new Error(`All nodes exhausted during parallel fetch: ${lastErrorMsg}`))
						}
						console.info(`Switching to next node for parallel fetch: ${node.name}`)
						// Retry this batch with new node by not advancing bytePos
						continue
					}
				}

				controller.close()
			}

			const fetchChunkAtOffset = async (offset: number, currentNode: typeof node): Promise<Uint8Array | null> => {
				if (!currentNode) return null

				const url = `${currentNode.url}/chunk2/${(chunkStart + BigInt(offset)).toString()}`
				const chunks: Uint8Array[] = []
				let chunkReq: http.ClientRequest | undefined
				let chunkRes: http.IncomingMessage | undefined

				try {
					const size = await fetchChunkData(url, (segment) => {
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
					const errorMsg = (e as Error).message
					lastErrorMsg = errorMsg
					console.error(`Parallel chunk fetch failed for offset ${offset}: ${errorMsg}`)
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
		const timeout = (message: string) => {
			req.destroy()
			reject(new Error(`${message}: ${url}`))
		}

		const req = http.get(url, { agent, headers: { 'x-packing': 'unpacked' } }, (res) => {
			if (res.statusCode !== 200) {
				res.destroy()
				return reject(new Error(`${url} failed: ${res.statusCode} ${res.statusMessage}`))
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
				chunkSize > 0 ? resolve(chunkSize) : reject(new Error('Connection ended before chunk header was fully read'))
			})
		})

		req.setTimeout(30_000, () => timeout('Request timeout after 30s'))
		req.on('error', reject)
	})
}


