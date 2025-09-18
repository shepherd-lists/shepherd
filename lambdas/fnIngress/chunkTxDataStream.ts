import { getByteRange } from '../../libs/byte-ranges/byteRanges'
import { chunkStream } from './chunkStream'
import { ReadableStream } from 'node:stream/web'


/**
 * stream a transaction's data from chunk nodes via chunkStream module.
 * 2 cases:
 *  - base tx: no initial bytes to skip. pass chunkStream directly.
 *  - data-item tx: need to skip initial bytes (first chunk boundary before data-item) + ans104 data-item header.
 */
export const chunkTxDataStream = async (txid: string, parent: string | null, parents: string[] | undefined): Promise<ReadableStream<Uint8Array>> => {
	const offsets = await getByteRange(txid, parent, parents)
	if (offsets.start === -1n) {
		throw new Error(`${chunkTxDataStream.name}: undiscoverable byte-range for txid=${txid} parent=${parent ?? 'null'}`)
	}

	const dataStart = Number(offsets.dataStart)
	const dataEnd = dataStart + Number(offsets.dataSize)
	const chunkStart = offsets.start + 1n // /chunk2 expects 1-based offset
	console.debug(`${txid} byte range obtained - dataStart:${dataStart}, dataEnd:${dataEnd}, chunkStart:${chunkStart}`)

	//simple case, base tx: no initial bytes to skip.
	if (dataStart === 0) {
		console.debug(`${txid} base tx - returning chunkStream directly`)
		return chunkStream(chunkStart, dataEnd, txid)
	}

	//complex case, data-item: need to skip initial bytes + data-item header
	console.debug(`${txid} data-item tx - creating filtered stream`)
	const rawStream = await chunkStream(chunkStart, dataEnd, txid)
	const reader = rawStream.getReader()

	let bytesSkipped = 0
	let headerBuffer = new Uint8Array(0)
	let headerParsed = false
	let streamCompleted = false

	return new ReadableStream({
		type: 'bytes',
		async start(controller) {
			console.debug(`${txid} data-item stream starting`)
		},
		async pull(controller) {
			if (streamCompleted) return
			try {
				while (true) {
					const { done, value } = await reader.read()
					if (done) {
						console.debug(`${txid} data-item stream reader done, closing controller`)
						streamCompleted = true
						try {
							reader.releaseLock()
							console.debug(`${txid} data-item stream reader lock released`)
						} catch (e) {
							console.warn(`${txid} reader.releaseLock() failed:`, e)
						}
						controller.close()
						console.debug(`${txid} data-item stream controller closed`)
						return
					}

					let data = value

					// Skip to dataStart first
					if (bytesSkipped < dataStart) {
						const skipFromThisChunk = Math.min(dataStart - bytesSkipped, data.length)
						bytesSkipped += skipFromThisChunk
						if (skipFromThisChunk < data.length) {
							data = data.subarray(skipFromThisChunk)
						} else {
							continue //skip this entire data chunk
						}
					}

					// Parse header when we have enough bytes
					if (!headerParsed) {
						const combined = new Uint8Array(headerBuffer.length + data.length)
						combined.set(headerBuffer)
						combined.set(data, headerBuffer.length)
						headerBuffer = combined

						const headerSize = parseDataItemHeader(headerBuffer)
						if (headerSize !== null) {
							headerParsed = true
							console.debug(`${txid} data-item header parsed, headerSize:${headerSize}`)
							const remaining = headerBuffer.subarray(headerSize)
							if (remaining.length > 0) {
								controller.enqueue(remaining)
								return // Let consumer process this chunk
							}
						}
					} else {
						controller.enqueue(data)
						return // Let consumer process this chunk
					}
				}
			} catch (error) {
				console.error(`${txid} data-item stream error:`, error)
				streamCompleted = true
				try {
					reader.releaseLock()
					console.debug(`${txid} data-item stream reader lock released on error`)
				} catch (e) {
					console.warn(`${txid} reader.releaseLock() on error failed:`, e)
				}
				controller.error(error)
			}
		},
		cancel(reason) {
			streamCompleted = true
			try {
				console.debug(`${txid} data-item stream cancel called with reason:`, reason)
				reader.cancel(reason)
			} catch (e) {
				console.warn(`${txid} reader.cancel() failed:`, e)
			}
			try {
				reader.releaseLock()
				console.debug(`${txid} data-item stream cancel lock released`)
			} catch (e) {
				console.warn(`${txid} reader.releaseLock() in cancel failed:`, e)
			}
		}
	})
}

const parseDataItemHeader = (buffer: Uint8Array): number | null => {
	try {
		return dataItemDataOffset(buffer)
	} catch {
		return null // Not enough bytes yet
	}
}

const dataItemDataOffset = (dataItem: Uint8Array) => {
	let offset = 0

	// Signature type (2 bytes)
	const sigType = new DataView(dataItem.buffer).getUint16(offset, true)
	offset += 2

	// Signature length depends on type: 512 most common (RSA/EdDSA); 65 secp256k1
	const sigLength = sigType === 3 ? 65 : 512
	offset += sigLength

	// Owner (512 bytes)
	offset += 512

	// Target presence byte + target
	const targetPresent = dataItem[offset] === 1
	offset += 1
	if (targetPresent) offset += 32

	// Anchor presence byte + anchor  
	const anchorPresent = dataItem[offset] === 1
	offset += 1
	if (anchorPresent) offset += 32

	// Number of tags (8 bytes)
	// const numTags = new DataView(dataItem.buffer).getBigUint64(offset, true)
	offset += 8

	// Tags bytes length (8 bytes)
	const tagsLength = new DataView(dataItem.buffer).getBigUint64(offset, true)
	offset += 8

	// Skip tags data
	offset += Number(tagsLength)

	// Remaining is content
	return offset;
}
