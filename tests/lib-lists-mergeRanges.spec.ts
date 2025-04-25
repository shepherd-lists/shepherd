import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { ByteRange, mergeErlangRanges } from '../libs/s3-lists/merge-ranges'
import { readFileSync, writeFileSync } from 'node:fs';


/** get length of ranges */
const rangesSize = (ranges: Array<ByteRange>, id: string) => {
	let total = 0
	let longest = 0
	for (const range of ranges) {
		const diff = range[1] - range[0]
		if (diff > longest) longest = diff
		total += diff
	}
	console.debug(id, 'longest', longest.toLocaleString())
	return total
}

/** load big test file of ranges */
let temp = readFileSync(
	new URL('./lib-nsfw.txt', import.meta.url), 'utf-8'
	// new URL('./lib-rangelist.txt', import.meta.url), 'utf-8'
).split('\n')
temp.pop() //remove last blank line
const original = temp.map(line => line.split(',').map(Number)) as Array<ByteRange>
temp.length = 0 //release


describe('lists mergeRanges tests', () => {

	it('should merge test data reducing number of ranges, but not total length', async () => {
		const small: Array<ByteRange> = [
			[0, 1],
			[2, 3], //in Erlang formatting 1 & 2 are **not** overlapping
			[3, 4],
		]

		// console.debug(`original: ${JSON.stringify(original)}, total length ${rangesLength(original)}`)

		const merged = mergeErlangRanges(small)
		// console.debug(`erlang: ${JSON.stringify(merged)}, total length ${rangesLength(merged)}`)

		assert(merged.length <= small.length, `expected less/equal ranges (${small.length}), got ${merged.length}`)
		assert(merged.length === 2, `expected merged length = 2, got ${merged.length}`)

		const mergedLength = rangesSize(merged, 'merged')
		const originalLength = rangesSize(small, 'original')
		assert((mergedLength <= originalLength), `${mergedLength} should be <= ${originalLength}. discrepancy of ${originalLength - mergedLength}`)

		console.info('end of first test \n')
	})



	it('should merge real data, reducing number of ranges, but not total length', async () => {

		const beforeSize = rangesSize(original, 'original')
		console.debug('original: size', beforeSize.toLocaleString(), 'length', original.length)

		/** erlang merge tests */
		const merged = mergeErlangRanges(original)
		const afterSize = rangesSize(original, 'original') //merge function is more performant with side-effect...
		const mergedSize = rangesSize(merged, 'merged')

		console.debug(`merge: size: ${mergedSize.toLocaleString()}, length: ${merged.length}`)

		assert((mergedSize <= beforeSize), `${mergedSize} should be <= ${beforeSize}. discrepancy of ${beforeSize - mergedSize}`)

		assert(beforeSize === afterSize, `${beforeSize} should be equal to ${afterSize}, unless we accept the side-effects for perf reasons...`)

	})

	it.skip('ensure that the original ranges completely overlap the merged range', async () => {

		console.info('/** Warning: this test will take a while to run. */')

		const merged = mergeErlangRanges(original)
		let count = 0
		for (const range of original) {
			++count
			if (count % 100_000 === 0) console.info(count)
			assert(merged.some(r => r[0] <= range[0] && r[1] >= range[1]), `original range ${JSON.stringify(range)} not completely contained in merged ranges`)
		}
		assert(true, 'end of second test \n')
	})

	it('checks if a specific byte is not covered in original and merged ranges', async () => {
		const testByte = 79274611613942
		let notFound = true
		for (const range of original) {
			if (testByte > range[0] && testByte <= range[1]) {
				notFound = false
				assert.fail(`${testByte} is in ${JSON.stringify(range)}`)
				break;
			}
		}
		assert(notFound, 'test byte not found')
		//...

		const merged = mergeErlangRanges(original)
		for (const range of merged) {
			if (testByte > range[0] && testByte <= range[1]) {
				notFound = false
				assert.fail(`${testByte} is in ${JSON.stringify(range)}`)
				break;
			}
		}
		assert(notFound, 'test byte not found')

	})

	it('should not mutate the input array', function () {
		const input: ByteRange[] = [
			[10, 20],
			[5, 15],
			[30, 40],
			[25, 35],
		]
		mergeErlangRanges(input)

		assert.deepEqual(input, [[1, 5], [6, 8]], 'Input array was mutated')
	})

})
