import http from 'node:http'
import { httpApiNodes } from '../../libs/utils/update-range-nodes'

const agent = new http.Agent({
	keepAlive: true,
	maxSockets: 100,
	maxFreeSockets: 10,
	timeout: 30000
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
		{ url: 'http://tip-4.arweave.xyz:1984', name: 'tip-4.arweave.xyz' },
		{ url: 'http://tip-2.arweave.xyz:1984', name: 'tip-2.arweave.xyz' },
		{ url: 'http://tip-3.arweave.xyz:1984', name: 'tip-3.arweave.xyz' },
	]
	let node = nodes.pop()

	let cancelled = false
	let currentReq: http.ClientRequest | null = null
	let currentRes: http.IncomingMessage | null = null

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let bytePos = 0 // bytes fetched so far
			console.log(`chunkStream starting: chunkStart=${chunkStart}, dataEnd=${dataEnd}, nodes=${nodes.length}`)

			const fetchNext = async (): Promise<void> => {
				while (!cancelled && bytePos < dataEnd) {
					if (!node) {
						console.error('chunkStream: Ran out of nodes to try', { chunkStart, dataEnd, bytePos })
						return controller.error(
							new Error(`chunkStream: Ran out of nodes to try, ${JSON.stringify({ chunkStart: chunkStart.toString(), dataEnd, bytePos })}`)
						)
					}

					const url = `${node.url}/chunk2/${(chunkStart + BigInt(bytePos)).toString()}`
					console.log(`Fetching from ${url} (bytePos=${bytePos}, remaining=${dataEnd - bytePos})`)
					try {
						const size = await fetchChunkData(url, (segment) => {
							//truncate segment if it would exceed dataEnd
							const remaining = dataEnd - bytePos
							if (remaining <= 0) return // Already at limit

							const truncated = remaining < segment.length
								? segment.subarray(0, remaining)
								: segment

							// console.log(`Streaming data segment: ${truncated.length} bytes (original: ${segment.length})`)
							controller.enqueue(truncated)
							bytePos += truncated.length
						}, (req, res) => {
							currentReq = req
							currentRes = res
						})
						console.log(`Completed network chunk: ${size} bytes`)
					} catch (err) {
						console.log(`Error from ${node.name}: ${err instanceof Error ? err.message : String(err)}, trying next node`)
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

				console.log(`Stream complete: bytePos=${bytePos}, dataEnd=${dataEnd}, cancelled=${cancelled}`)
				if (!cancelled) controller.close()
			}

			fetchNext().catch(e => controller.error(e))
		},
		cancel(reason) {
			cancelled = true
			if (currentRes) currentRes.destroy()
			if (currentReq) currentReq.destroy()
			console.info('chunkStream cancelled:', reason)
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
		console.log(`fetchChunkData: requesting ${url}`)
		const req = http.get(url, { agent, headers: { 'x-packing': 'unpacked' } }, (res) => {
			console.log(`fetchChunkData: response ${res.statusCode} from ${url}`)
			if (res.statusCode !== 200) {
				res.destroy()
				return reject(new Error(`${url} failed: ${res.statusCode}`))
			}

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
						// read 3-byte big-endian length prefix
						const toCopy = Math.min(headerBytesNeeded, buf.length - offset)
						headerBuf.set(buf.subarray(offset, offset + toCopy), headerOffset)
						headerOffset += toCopy
						offset += toCopy
						headerBytesNeeded -= toCopy
						if (headerBytesNeeded === 0) {
							chunkSize = (headerBuf[0] << 16) | (headerBuf[1] << 8) | headerBuf[2]
							console.log(`fetchChunkData: parsed chunk size: ${chunkSize}`)
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
						console.log(`fetchChunkData: completed chunk, returning size ${chunkSize}`)
						res.removeAllListeners('data')
						res.removeAllListeners('end')
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
		req.on('error', reject)
	})
}
