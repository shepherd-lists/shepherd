import 'dotenv/config'
import { describe, it, skip, after } from 'node:test'
import assert from 'node:assert/strict'
import { chunkTxDataStream } from '../lambdas/fnIngress/chunkTxDataStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { writeFileSync } from 'node:fs'

describe('chunkTxDataStream', () => {
	const baseTxid = 'YqIGNFqScA5bIGLpt083Zp7fHcz7ApL-Do1e1bhMM3Q' //size 520kb, text/html
	const baseTxidSize = 584685

	const diId = 'hYvWBh8atbm8WzwLdp8qTHGncGYFcnPdSfUPfF0jj0I' //size 8.05mb, text/plain
	const diParent = 'BPdVS50l0LdiM2w8mYYXX_v31UM9MOMx0zpXSUiA69A'
	const diSize = 8047240 //size *without* header

	after(async () => {
		clearTimerHttpApiNodes()
	})

	it('should stream base tx data', async () => {

		const stream = await chunkTxDataStream(baseTxid, null, undefined)

		const data = new Uint8Array(baseTxidSize)
		let offset = 0

		for await (const chunk of stream) {
			data.set(chunk, offset)
			offset += chunk.length
		}

		assert(offset === baseTxidSize, `expected ${baseTxidSize} bytes, got ${offset}`)

		//verify specific bytes to ensure data integrity
		const htmlStart = new TextDecoder().decode(data.slice(0, 16))
		assert('<html lang="en">' === htmlStart, `Expected HTML content at start, got: ${htmlStart}`)
		const htmlEnd = new TextDecoder().decode(data.slice(-7))
		assert(htmlEnd.includes('</html>'), `Expected HTML closing tag at end, got: ${htmlEnd}`)
	})

	it('should stream data-item tx data', async () => {

		const stream = await chunkTxDataStream(diId, diParent, undefined)

		const data = new Uint8Array(diSize)
		let offset = 0

		for await (const buff of stream) {
			data.set(buff, offset)
			offset += buff.length
		}

		assert(offset === diSize, `expected ${diSize} bytes, got ${offset}`)

		//verify specific bytes to ensure data integrity
		const textStart = new TextDecoder().decode(data.slice(0, 14))
		assert('1223629983330,' === textStart, `Expected text content at start, got: "${textStart}"`)
		const textEnd = new TextDecoder().decode(data.slice(-17))
		assert(',281936194216182\n' === textEnd, `Expected text content at end, got: "${textEnd}"`)
	})

	it('should handle data-item stream cancellation gracefully', async () => {
		const stream = await chunkTxDataStream(diId, diParent, undefined)

		let offset = 0
		const data = new Uint8Array(diSize)
		for await (const buff of stream) {
			data.set(buff, offset)
			offset += buff.length
			if (offset > 4_000) break;
		}

		assert(offset > 4_000, `expected to read more than 4000 bytes, got ${offset}`)

		const textStart = new TextDecoder().decode(data.slice(0, 14))
		assert('1223629983330,' === textStart, `Expected text content at start, got: "${textStart}"`)

	})

	it('should handle 404 errors for nonexistent data', async () => {
		const noDataId = 'kbn9dYQayN0D7BNsblAnrnlQnQtbXOA6foVUkk5ZHgw' //13 byte
		const stream = await chunkTxDataStream(noDataId, null, undefined)

		try {
			for await (const chunk of stream) {
				assert.fail('should not have any data')
			}
		} catch (e) {
			if (e instanceof Error) {
				assert.ok(e.message.includes('ran out of nodes to try'), 'expected ran out of nodes to try error')
				assert.ok(e.message.includes('404'), 'expected 404 error')
			} else {
				assert.fail('expected error')
			}
		}
	})

	skip('should download a 700mb file using concurrent chunks', async () => {
		const t0 = Date.now()
		const txid = 'izeI_QzFiIYWJYs66E--QL5oUFbN471aVUt1KHZD3OI' //700mb video/mp4
		const stream = await chunkTxDataStream(txid, null, undefined)


		const data = new Uint8Array(695_557_456)
		let offset = 0

		for await (const chunk of stream) {
			data.set(chunk, offset)
			offset += chunk.length
		}

		console.info(`downloaded 700mb file in ${(Date.now() - t0) / 1000}s`)

		//temp
		writeFileSync('700mb.mp4', data)

		assert(offset === 695_557_456, `expected 695557456 bytes, got ${offset}`)
	})

	// it('should download a large test file using concurrent chunks', async () => {
	// 	const txid = 'xPemxl1eioHIL1aov9Des_JPtdWnnISHWZGga4E3l28' //140mb video/mp4
	// 	const parent = 'g3jBbb8U8Bm4kEKinYQd2T0dy8x3Fv8uc__CtYTtT2M'
	// 	const stream = await chunkTxDataStream(txid, parent, undefined)


	// 	const data = new Uint8Array(147523153)
	// 	let offset = 0

	// 	for await (const chunk of stream) {
	// 		data.set(chunk, offset)
	// 		offset += chunk.length
	// 	}

	// 	// assert(offset === 695_557_456, `expected 695557456 bytes, got ${offset}`)

	// 	//temp
	// 	writeFileSync(`${txid}.mp4`, data)
	// })

})
