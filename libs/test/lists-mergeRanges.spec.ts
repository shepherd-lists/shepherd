import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { ByteRange, mergeErlangRanges } from '../s3-lists/merge-ranges'
import { readFileSync } from 'node:fs';


/** get length of ranges */
const rangesSize = (ranges: Array<ByteRange>) => {
	let total = 0
	let longest = 0
	for (const range of ranges) {
		const diff = range[1] - range[0]
		if (diff > longest) longest = diff
		total += diff
	}
	console.debug('longest', longest.toLocaleString())
	return total
}


describe('lists mergeRanges tests', () => {

	it('should merge test data reducing number of ranges, but not total length', async () => {
		const original: Array<ByteRange> = [
			[0, 1],
			[2, 3], //in Erlang formatting 1 & 2 are **not** overlapping
			[3, 4],
		]

		// console.debug(`original: ${JSON.stringify(original)}, total length ${rangesLength(original)}`)

		const merged = mergeErlangRanges(original)
		// console.debug(`erlang: ${JSON.stringify(merged)}, total length ${rangesLength(merged)}`)

		assert(merged.length <= original.length, `expected less/equal ranges (${original.length}), got ${merged.length}`)

		const mergedLength = rangesSize(merged)
		const originalLength = rangesSize(original)
		assert((mergedLength <= originalLength), `${mergedLength} should be <= ${originalLength}. discrepancy of ${originalLength - mergedLength}`)
	})



	it('should merge real data, reducing number of ranges, but not total length', async () => {
		const file = readFileSync(
			new URL('./nsfw.txt', import.meta.url), 'utf-8'
		).split('\n')
		file.pop() //remove last blank line
		const original = file.map(line => line.split(',').map(Number)) as Array<ByteRange>

		const beforeSize = rangesSize(original)
		console.debug('original: size', beforeSize.toLocaleString(), 'length', original.length)

		/** erlang merge tests */
		const merged = mergeErlangRanges(original)
		const afterSize = rangesSize(original) //merge function is more performant with side-effect...
		const mergedSize = rangesSize(merged)

		console.debug(`merge: size: ${mergedSize.toLocaleString()}, length: ${merged.length}`)

		assert((mergedSize <= beforeSize), `${mergedSize} should be <= ${beforeSize}. discrepancy of ${beforeSize - mergedSize}`)

		assert(beforeSize === afterSize, `${beforeSize} should be equal to ${afterSize}, unless we accept the side-effects for perf reasons...`)



	})

})
