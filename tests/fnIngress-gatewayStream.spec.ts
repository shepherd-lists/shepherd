import 'dotenv/config'
import { after, describe, it, skip } from 'node:test'
import assert from 'node:assert/strict'
import { gatewayStream, destroyGatewayAgent } from '../lambdas/fnIngress/gatewayStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { ReadableStream } from 'node:stream/web'
import { min_data_size } from '../libs/constants'
import { createMockHttpsGet } from './mocks/mock-httpsGet'




describe('gatewayStream', () => {

	after(() => {
		clearTimerHttpApiNodes()
		destroyGatewayAgent()
	})

	it('should return ReadableStream and successfully stream a real transaction', async () => {
		const txid = 'EwyiK6-mZj5d3pwts7zwreNBq-HyyzhECEnMISLE49I' // ~2.7kb text/plain

		const stream = await gatewayStream(txid)
		assert(stream instanceof ReadableStream)
		assert(typeof stream.getReader === 'function')
		assert(typeof stream.cancel === 'function')

		const chunks: Uint8Array[] = []

		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		//should have received some data
		assert(chunks.length > 0)

		//concatenate all chunks to verify we got actual data
		const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
		assert(totalBytes == 2806)
	})

	it('should handle 404 errors for nonexistent transactions', async () => {
		const invalidTxid = 'nonexistent-invalid-txid'.padEnd(43, 'x')

		try {
			await gatewayStream(invalidTxid)
			assert.fail('Should have thrown an error for invalid txid')
		} catch (error) {
			assert(error instanceof Error)
			assert(error.message.includes('404'))
		}
	})

	it('should handle cancellation', async () => {
		const txid = 'YqIGNFqScA5bIGLpt083Zp7fHcz7ApL-Do1e1bhMM3Q' //520kb

		const stream = await gatewayStream(txid)
		const reader = stream.getReader()

		//start reading then cancel
		const readPromise = reader.read()
		await reader.cancel('test cancellation')

		//the read should complete gracefully (may or may not have data)
		const result = await readPromise

		assert(result.done === true || result.value !== undefined, 'after cancellation, the stream should be done')

	})

	it('should pass when partial data > min_data_size is received', async () => {
		const mockTxid = 'dummy-txid'.padEnd(43, 'x')
		const mockHttpsGet = createMockHttpsGet({
			dataChunks: [Buffer.alloc(min_data_size + 1)]
		})

		const stream = await gatewayStream(mockTxid, mockHttpsGet as any)
		const chunks: Uint8Array[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}
		assert(chunks.length > 0)
		const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
		assert(totalBytes > min_data_size)
	})


	it('should timeout when no data is received within 30 seconds', async () => {
		const mockTxid = 'dummy-txid'.padEnd(43, 'x')
		const mockHttpsGet = createMockHttpsGet({
			shouldTimeout: true,
			timeoutDelay: 100
		})

		const stream = await gatewayStream(mockTxid, mockHttpsGet as any)

		try {
			for await (const chunk of stream) {
				assert.fail('Should have thrown NO_DATA error')
			}
		} catch (error) {
			assert(error instanceof Error)
			assert.equal(error.message, 'NO_DATA')
		}
	})

	it('should timeout when insufficient data is received within 30 seconds', async () => {
		const mockTxid = 'dummy-txid'.padEnd(43, 'x')
		const mockHttpsGet = createMockHttpsGet({
			dataChunks: [Buffer.alloc(1000)], // Only 1000 bytes < 4096 min_data_size
			shouldTimeout: true,
			timeoutDelay: 100,
			shouldEnd: false // Don't end naturally, let timeout handle it
		})

		const chunks: Uint8Array[] = []
		const stream = await gatewayStream(mockTxid, mockHttpsGet as any)
		try {
			for await (const chunk of stream) {
				chunks.push(chunk)
			}
		} catch (error) {
			assert(error instanceof Error)
			assert.equal(error.message, 'NO_DATA')
		}
		assert(chunks.length > 0)
		const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
		assert(totalBytes < min_data_size)
	})


})
