import http from 'node:http'


const agent = new http.Agent({
	keepAlive: true,
	maxSockets: 100,
	maxFreeSockets: 5,
	timeout: 30_000
})

export const destroyChunkStreamAgent = () => agent.destroy()


/**
 * Fetch a single /chunk2 response and emit all chunk payload bytes.
 * Returns the chunk size that was processed. 
 * N.B. this is uncancellable because:
 *  the chunk usually downloads too quickly to cancel.
 *  the arweave node is _unaffected_ as it will process request regardless of request/connection status. it's nothing to them.
 */
export function fetchChunkData(
	txid: string,
	url: string,
	abortSignal: AbortSignal,
	onSegment: (segment: Uint8Array) => void,
	onSize: (size: number) => void,
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
						onSize(chunkSize)
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

