/**
 * NOTICE
 * This file uses code inspired from the Apache 2.0 licensed code permalinked here
 * (https://github.com/Bundlr-Network/arbundles/blob/c6aa659a63d386066504e7cd8cab415d422d4f8f/stream/index.ts#L1-L195).
 * The license of the shepherd repo is LGPL-3.0-or-later which is compatible.
 */
import Arweave from 'arweave'
import { chunkTxDataStream } from '../../chunkStreams/chunkTxDataStream'
import { ReadableStreamDefaultReader } from 'node:stream/web'
import moize from 'moize'


//bundlr style conversion
const byteArrayToNumber = (buffer: Uint8Array): number => {
	let value = 0
	for (let i = buffer.length - 1; i >= 0; --i) {
		value = value * 256 + buffer[i]
	}
	return value
}

const readEnoughBytes = async (
	reader: ReadableStreamDefaultReader,
	buffer: Uint8Array<ArrayBuffer>,
	length: number,
): Promise<Uint8Array<ArrayBuffer>> => {
	if (buffer.byteLength > length) return buffer!

	let { done, value } = await reader.read()

	if (done && !value) throw new Error('Invalid stream buffer')

	//concat and clean up old buffers for gc
	const joined = concatByteArray(buffer, value)
	buffer = null as unknown as Uint8Array<ArrayBuffer> // keep ts happy
	value = null

	return readEnoughBytes(reader, joined, length)
}
const concatByteArray = (a: Uint8Array, b: Uint8Array) => {
	const temp = new Uint8Array(a.byteLength + b.byteLength)
	temp.set(a)
	temp.set(b, a.byteLength)
	return temp
}

const fetchHeader = async (bundleId: string, parent: string | null, parents: string[] | undefined) => {
	const abortController = new AbortController()
	try {
		const stream = await chunkTxDataStream(bundleId, parent, parents, abortController.signal)
		const reader = stream.getReader()

		let header = new Uint8Array(0)

		header = await readEnoughBytes(reader, header, 32)
		const numDataItems = byteArrayToNumber(header.slice(0, 32))
		const totalHeaderLength = 64 * numDataItems + 32

		if (process.env['NODE_ENV'] === 'test') console.log(`bytes read ${header.length}`, { numDataItems, totalHeaderLength })

		header = await readEnoughBytes(reader, header, totalHeaderLength)

		if (process.env['NODE_ENV'] === 'test') console.log(`bytes read ${header.length}`)

		reader.releaseLock()

		return {
			status: 200,
			header,
			numDataItems,
			headerLength: BigInt(totalHeaderLength),
		}
	} finally {
		abortController.abort()
	}
}

const ans104HeaderDataUnmemoized = async (bundleId: string, parent: string | null, parents: string[] | undefined) => {

	/* get data stream */

	let { status, header, numDataItems, headerLength } = await fetchHeader(bundleId, parent, parents)

	/* process the return data */

	const diIds: string[] = []
	const diSizes: number[] = []

	for (let i = 0; i < numDataItems; i++) {
		const base = 32 + i * 64
		const nextSize = byteArrayToNumber(header.subarray(
			base,
			base + 32,
		))
		diSizes.push(nextSize)

		const nextId = Arweave.utils.bufferTob64Url(header.subarray(
			base + 32,
			base + 64,
		))
		diIds.push(nextId)
	}

	//ensure buffer available for gc
	header = null as unknown as Uint8Array<ArrayBuffer> // keep ts happy

	return {
		status,
		numDataItems,
		diIds,
		diSizes,
		headerLength,
	}
}
export const ans104HeaderData = moize(ans104HeaderDataUnmemoized, { maxSize: 1000, isPromise: true })
