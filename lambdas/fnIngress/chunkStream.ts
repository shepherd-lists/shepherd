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
export async function chunkStream(
	chunkStart: bigint,
	dataEnd: number,
	txid: string,
	abortSignal: AbortSignal, //for cancelling batches (these controllers are not expensive)
): Promise<ReadableStream<Uint8Array>> {
	const nodes = [
		...httpApiNodes(),
		//manually adding these for now
		{ url: 'http://tip-2.arweave.xyz:1984', name: 'tip-2.arweave.xyz' },
		{ url: 'http://tip-4.arweave.xyz:1984', name: 'tip-4.arweave.xyz' },
		{ url: 'http://tip-3.arweave.xyz:1984', name: 'tip-3.arweave.xyz' },
	]
	let nodeIndex = nodes.length - 1
	let lastErrorMsg = ''

	let currentReq: http.ClientRequest | null = null
	let currentRes: http.IncomingMessage | null = null

	const stream = new ReadableStream({
		type: 'bytes',
		start(controller) {
			let bytePos = 0
			let chunksProcessed = 0
			console.log(txid, `chunkStream starting: chunkStart=${chunkStart}, dataEnd=${dataEnd}, nodes=${nodes.length}`)

			const controllerErrorAborted = () => {
				console.info(txid, `chunkStream aborted. reason: ${abortSignal?.reason ?? 'aborted'}`)
				controller.error(new Error(abortSignal?.reason ?? 'aborted'))
			}

			const fetchNext = async (): Promise<void> => {
				// Fetch chunks serially
				while (!abortSignal.aborted && bytePos < dataEnd) {
					if (nodeIndex < 0) {
						throw new Error(`chunkStream: ran out of nodes to try, ${JSON.stringify({ chunkStart: chunkStart.toString(), dataEnd, bytePos, lastErrorMsg })}`)
					}

					const url = `${nodes[nodeIndex].url}/chunk2/${(chunkStart + BigInt(bytePos)).toString()}`

					try {
						await fetchChunkData(txid, url, abortSignal, (segment) => {
							if (abortSignal.aborted) return controllerErrorAborted()
							const remaining = dataEnd - bytePos
							if (remaining <= 0) return

							const truncated = remaining < segment.length ? segment.subarray(0, remaining) : segment
							const truncatedLength = truncated.length
							controller.enqueue(truncated)
							bytePos += truncatedLength
						}, (req, res) => {
							currentReq = req
							currentRes = res
						})

						chunksProcessed++
						console.info(txid, `${url} ${bytePos}/${dataEnd} bytes ✅ (chunk ${chunksProcessed})`)
					} catch (e) {
						if (e instanceof Error && e.name === 'AbortError') {
							return controllerErrorAborted()
						}

						console.error(txid, `${String(e)}, ${bytePos}/${dataEnd} bytes. trying next node`)
						lastErrorMsg = (e as Error).message
						nodeIndex--
					}
					finally {
						currentReq?.destroy()
						currentRes?.destroy()
						currentReq = null
						currentRes = null
					}
				}

				// Verify completion
				if (abortSignal.aborted) return controllerErrorAborted()
				if (bytePos < dataEnd) {
					console.error(txid, `chunkStream incomplete: ${bytePos}/${dataEnd} bytes fetched`)
					return controller.error(new Error(`Incomplete download: ${bytePos}/${dataEnd} bytes`))
				}

				console.info(txid, `chunkStream completed successfully: ${bytePos}/${dataEnd} bytes, ${chunksProcessed} chunks`)
				controller.close()
			}

			fetchNext().catch(e => controller.error(e))
		},
		cancel(reason) {
			currentReq?.destroy()
			currentRes?.destroy()
			currentReq = null
			currentRes = null
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
	abortSignal: AbortSignal,
	onSegment: (segment: Uint8Array) => void,
	// onSize: (size: number) => void,
	onReq?: (req: http.ClientRequest, res: http.IncomingMessage) => void,
): Promise<number> {
	return new Promise((resolve, reject) => {
		const timeout = (message: string) => {
			req.destroy()
			reject(new Error(`${txid} ${message}: ${url}`))
		}

		const req = http.get(url, { agent, headers: { 'x-packing': 'unpacked' }, signal: abortSignal }, (res) => {
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

			res.on('data', (buf: Buffer) => {
				if (abortSignal.aborted) return;

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
						// onSize(chunkSize)
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
			})

			res.on('end', () => {
				chunkSize > 0 ? resolve(chunkSize) : reject(new Error(`${txid} Connection ended before chunk header was fully read`))
			})
		})

		req.setTimeout(30_000, () => timeout('Request timeout after 30s'))
		req.on('error', reject)
	})
}

