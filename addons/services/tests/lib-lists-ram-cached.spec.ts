import 'dotenv/config'
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { ByteRange } from '../libs/s3-lists/merge-ranges'
import { uniqTxidArray, normalizedRanges } from '../libs/s3-lists/ram-lists'
import { idToBase32 } from '../libs/utils/id-to-base32'



describe('uniqTxidArray', () => {
	it('should add unique items to the array', () => {
		const txids = uniqTxidArray()
		txids.add('item1')
		txids.add('item2')
		assert.deepStrictEqual(txids.getTxids(), [
			{ id: 'item1', base32: idToBase32('item1') },
			{ id: 'item2', base32: idToBase32('item2') },
		])
	})

	it('should not add duplicate items to the array', () => {
		const txids = uniqTxidArray()
		txids.add('item1')
		txids.add('item1')
		assert.deepStrictEqual(txids.getTxids(), [{ id: 'item1', base32: idToBase32('item1') }])
	})

	it('should remove items from the array', () => {
		const txids = uniqTxidArray()
		txids.add('item1')
		txids.remove('item1')
		assert.deepStrictEqual(txids.getTxids(), [])
	})

	it('should not throw an error when removing a non-existent item', () => {
		const txids = uniqTxidArray()
		txids.remove('item1')
		assert.deepStrictEqual(txids.getTxids(), [])
	})
	it('should return an empty array when no items are added', () => {
		const txids = uniqTxidArray()
		assert.deepStrictEqual(txids.getTxids(), [])
	})
})

describe('normalizedRanges', () => {

	it('tests add/remove/ranges', async () => {
		const ranges = normalizedRanges()
		const add1: ByteRange = [100, 200]
		const add2: ByteRange = [300, 400]
		ranges.add([add1, add2])
		assert.deepEqual(await ranges.getRanges(), [add1, add2])

		ranges.add([[200, 300]])
		assert.deepEqual(await ranges.getRanges(), [[100, 400]])

		ranges.remove([[200, 250], [225, 300]])
		assert.deepEqual(await ranges.getRanges(), [[100, 200], [300, 400]])

		ranges.add([[150, 299]])
		assert.deepEqual(await ranges.getRanges(), [[100, 299], [300, 400]]) //erlang format

	})

})