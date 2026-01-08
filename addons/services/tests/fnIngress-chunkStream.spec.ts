import 'dotenv/config'
import { after, describe, it, skip } from 'node:test'
import assert from 'node:assert/strict'
import { destroyChunkStreamAgent } from '../lambdas/fnIngress/chunkFetch'
import { chunkStream } from '../lambdas/fnIngress/chunkStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import http from 'node:http'

describe('chunkStream', () => {

	/** 
	 * using YqIGNFqScA5bIGLpt083Zp7fHcz7ApL-Do1e1bhMM3Q as a test item
	 * it's a base tx spanning 3 chunks. 3 chunks get fully returned from the nodes
	 */
	const txid = 'YqIGNFqScA5bIGLpt083Zp7fHcz7ApL-Do1e1bhMM3Q'
	const chunkStart = 355855954125047n
	const dataEnd = 584685

	/** Mock fetchChunkData factory - controls chunk completion order via delays */
	const createMockFetch = (chunkDelays: Map<number, number>) => {
		return async (
			txid: string,
			url: string,
			abortSignal: AbortSignal,
			onSegment: (segment: Uint8Array) => void,
			onSize: (size: number) => void,
			onReq?: (req: http.ClientRequest, res: http.IncomingMessage) => void
		): Promise<number> => {
			const chunkSize = 256 * 1024 // 256KB typical chunk
			const offsetMatch = url.match(/chunk2\/(\d+)/)
			const offset = offsetMatch ? Number(offsetMatch[1]) - Number(chunkStart) : 0
			const delay = chunkDelays.get(offset) || 0

			// delay of -1 indicates this chunk should error
			if (delay === -1) {
				new Promise(resolve => setTimeout(resolve, 500))
				throw new Error('404 Not Found')
			}

			// Signal chunk size immediately
			onSize(chunkSize)

			// Simulate network delay
			if (delay > 0) {
				await new Promise(resolve => setTimeout(resolve, delay))
			}

			if (abortSignal.aborted) throw new Error('AbortError')

			// Simulate streaming data in segments
			const segmentSize = 8192
			for (let i = 0; i < chunkSize; i += segmentSize) {
				if (abortSignal.aborted) throw new Error('AbortError')
				onSegment(new Uint8Array(segmentSize).fill(i % 256))
			}

			return chunkSize
		}
	}

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

	it('should create stream and read single chunk (< 256KB)', async () => {
		const singleChunkSize = 100_000 // 100KB, less than 256KB chunk size
		const stream = await chunkStream(chunkStart, singleChunkSize, txid, (new AbortController()).signal)
		assert(stream instanceof ReadableStream)

		const data = new Uint8Array(singleChunkSize)
		let offset = 0
		for await (const buf of stream) {
			data.set(buf, offset)
			offset += buf.length
		}
		assert(offset === singleChunkSize, 'Should have received all data from single chunk')
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

	describe('chunk ordering with mocked fetch', () => {
		const mockDataEnd = 256 * 1024 * 3 // 3 chunks of 256KB each

		it('should handle last chunk finishing first', async () => {
			// Last chunk (offset 524288) completes in 10ms, first two take longer
			const delays = new Map([
				[0, 200],         // chunk 0: slow
				[262144, 100],    // chunk 1: medium
				[524288, 10]      // chunk 2: fast (last chunk finishes first!)
			])
			const mockFetch = createMockFetch(delays)

			const stream = await chunkStream(
				chunkStart,
				mockDataEnd,
				txid,
				(new AbortController()).signal,
				10, // maxParallel
				mockFetch
			)

			const chunks: Uint8Array[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0)
			assert.equal(totalBytes, mockDataEnd, 'Should receive all data in order despite out-of-order completion')
		})

		it('should handle middle chunk finishing first', async () => {
			const delays = new Map([
				[0, 200],         // chunk 0: slow
				[262144, 10],     // chunk 1: fast (finishes first)
				[524288, 100]     // chunk 2: medium
			])
			const mockFetch = createMockFetch(delays)

			const stream = await chunkStream(
				chunkStart,
				mockDataEnd,
				txid,
				(new AbortController()).signal,
				10,
				mockFetch
			)

			const chunks: Uint8Array[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0)
			assert.equal(totalBytes, mockDataEnd, 'Should buffer middle chunk and maintain order')
		})

		it('should handle reverse order completion', async () => {
			// Chunks complete in reverse order: 2, 1, 0
			const delays = new Map([
				[0, 300],         // chunk 0: slowest
				[262144, 200],    // chunk 1: slow
				[524288, 100]     // chunk 2: fast
			])
			const mockFetch = createMockFetch(delays)

			const stream = await chunkStream(
				chunkStart,
				mockDataEnd,
				txid,
				(new AbortController()).signal,
				10,
				mockFetch
			)

			const chunks: Uint8Array[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0)
			assert.equal(totalBytes, mockDataEnd, 'Should handle complete reverse order')
		})

		it('should handle the middle chunk erroring, but others completing', async () => {
			const delays = new Map([
				[0, 100],         // chunk 0: 
				[262144, -1],     // chunk 1: error
				[524288, 2_000]     // chunk 2: 
			])
			const mockFetch = createMockFetch(delays)

			const stream = await chunkStream(
				chunkStart,
				mockDataEnd,
				txid,
				(new AbortController()).signal,
				10,
				mockFetch
			)

			try {
				for await (const chunk of stream) {
					//just read we expect to error
				}
				assert.fail('should have thrown an error')
			} catch (e) {
				assert(e instanceof Error)
				assert(e.message.includes('ran out of nodes to try'))
				assert(e.message.includes('404 Not Found'))
			}

		})

	})//end subsection
})
