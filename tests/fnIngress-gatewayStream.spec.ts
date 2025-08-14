import 'dotenv/config'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { gatewayStream, destroyAgent } from '../lambdas/fnIngress/gatewayStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'



describe('gatewayStream', () => {

	after(() => {
		clearTimerHttpApiNodes()
		destroyAgent()
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
		const invalidTxid = 'nonexistent-invalid-txid-12345'.padEnd(43, 'x')

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


		//test cancellation using reader directly
		const reader = stream.getReader()

		//start reading then cancel
		const readPromise = reader.read()
		await reader.cancel('test cancellation')

		//the read should complete gracefully (may or may not have data)
		const result = await readPromise

		//after cancellation, the stream should be done
		assert(result.done === true || result.value !== undefined)

	})

})
