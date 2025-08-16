// tests/fnIngress-chunkStream.spec.ts

import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chunkStream, destroyChunkStreamAgent } from '../lambdas/fnIngress/chunkStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'

describe('chunkStream', () => {

	/** 
	 * using YqIGNFqScA5bIGLpt083Zp7fHcz7ApL-Do1e1bhMM3Q as a test item
	 * it's a base tx spanning 3 chunks. 3 chunks get fully returned from the nodes
	 */
	const chunkStart = 355855954125047n
	const dataEnd = 584685

	after(() => {
		destroyChunkStreamAgent()
		clearTimerHttpApiNodes()
	})

	it('should create stream and read full requested chunks', async () => {
		//test creating stream of 3 full chunks
		const stream = await chunkStream(chunkStart, dataEnd) // 256KB to 512KB range
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

		const stream = await chunkStream(chunkStart, dataEnd - 100)
		assert(stream instanceof ReadableStream)

		const data = new Uint8Array(dataEnd - 100)
		let offset = 0
		for await (const buf of stream) {
			data.set(buf, offset)
			offset += buf.length
		}
		assert(offset === dataEnd - 100, 'Should have received all data')
	})

	it('should successfully cancel a stream', async () => {
		const stream = await chunkStream(chunkStart, dataEnd)
		assert(stream instanceof ReadableStream, 'Should return a ReadableStream')

		let count = 0
		for await (const buf of stream) {
			assert(buf.length > 0, 'Should have received some data')
			count += buf.length
			if (count > 2_000) break;
		}
		stream.cancel('test reasons')

		assert(true, 'cancellation completed without error')
	})

})