import { after, describe, it, skip } from 'node:test'
import assert from 'node:assert/strict'
import { chunkStream, destroyChunkStreamAgent } from '../lambdas/fnIngress/chunkStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'

describe('chunkStream', () => {

	/** 
	 * using YqIGNFqScA5bIGLpt083Zp7fHcz7ApL-Do1e1bhMM3Q as a test item
	 * it's a base tx spanning 3 chunks. 3 chunks get fully returned from the nodes
	 */
	const txid = 'YqIGNFqScA5bIGLpt083Zp7fHcz7ApL-Do1e1bhMM3Q'
	const chunkStart = 355855954125047n
	const dataEnd = 584685


	after(() => {
		destroyChunkStreamAgent()
		clearTimerHttpApiNodes()
	})

	it('should create stream and read full requested chunks', async () => {
		//test creating stream of 3 full chunks
		const stream = await chunkStream(chunkStart, dataEnd, txid, (new AbortController()).signal) // 256KB to 512KB range
		assert(stream instanceof ReadableStream)

		const data = new Uint8Array(dataEnd)
		let offset = 0
		for await (const buf of stream) {
			data.set(buf, offset)
			offset += buf.length
		}
		assert(data.length === dataEnd, 'Should have received all data')
	})


	it('should create stream and read partial requested chunks', async () => {

		const stream = await chunkStream(chunkStart, dataEnd - 100, txid, (new AbortController()).signal)
		assert(stream instanceof ReadableStream)

		const data = new Uint8Array(dataEnd - 100)
		let offset = 0
		for await (const buf of stream) {
			data.set(buf, offset)
			offset += buf.length
		}
		assert(offset === dataEnd - 100, 'Should have received all data')
	})

	it('should cancel a stream', async () => {
		const stream = await chunkStream(chunkStart, dataEnd, txid, (new AbortController()).signal)
		assert(stream instanceof ReadableStream, 'Should return a ReadableStream')

		let count = 0
		for await (const buf of stream) {
			assert(buf.length > 0, 'Should have received some data')
			count += buf.length
			if (count > 2_000) break; //cancels the stream
		}

		assert(true, 'cancellation completed without error')
	})

	it('should abort a stream', async () => {
		const abortController = new AbortController()
		const stream = await chunkStream(chunkStart, dataEnd, txid, abortController.signal)

		const reader = stream.getReader()
		// const readPromise = reader.read()
		abortController.abort('test abort')

		await assert.rejects(reader.read(), /test abort|aborted/)

	})

	it('should handle 404 errors for nonexistent data', async () => {
		const noDataId = 'kbn9dYQayN0D7BNsblAnrnlQnQtbXOA6foVUkk5ZHgw' //13 byte

		const stream = await chunkStream(1686542281742n, 13, noDataId, (new AbortController()).signal)
		assert(stream instanceof ReadableStream)

		try {
			// Try to read from the stream - this should error
			for await (const buf of stream) {
				// Should not reach here
			}
			assert.fail('Should have thrown an error for running out of nodes 404 Not Found')
		} catch (error) {
			assert(error instanceof Error)
			assert(error.message.includes('ran out of nodes to try'))
			assert(error.message.includes('404 Not Found'))
		}
	})


})
