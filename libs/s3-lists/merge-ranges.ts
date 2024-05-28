

export type ByteRange = [number, number]


/** this merges **erlang data format** ranges */
export const mergeErlangRanges = (ranges: Array<ByteRange>) => {

	/** DEBUG / Sanity */
	const originalSize = rangesSize(ranges, 'original')

	const t0 = performance.now()

	/** merge contiguous ranges */

	const mergedRanges: ByteRange[] = []
	if (ranges.length > 0) {
		// Step 1: Sort the ranges by their start value
		ranges.sort((a, b) => a[0] - b[0])

		console.debug('lowest', ranges[0])
		console.debug('highest', ranges[ranges.length - 1])

		// Step 2: Initialize the first range as the current range to compare with others
		let currentRange = ranges[0]
		mergedRanges.push(currentRange)

		// Step 3: Iterate through the ranges, starting from the second range
		ranges.slice(1).forEach(range => {
			const [currentStart, currentEnd] = currentRange
			const [nextStart, nextEnd] = range

			// If the next range overlaps or is adjacent to the current range, merge them
			if (nextStart <= currentEnd) {
				// Update the end of the current range in the mergedRanges array
				currentRange[1] = Math.max(currentEnd, nextEnd)
			} else {
				// If not overlapping or adjacent, move to the next range
				currentRange = [...range] //copy avoids side-effect, but decreases func perf by ~35%
				mergedRanges.push(currentRange)
			}
		})
	}
	/** w/o copy at this point `ranges` is totally messed up */
	// ranges.length = 0 // clear it, so it throws error on accidental reuse?

	console.info(mergeErlangRanges.name, `examined, sorted & merged ${ranges.length} ranges to ${mergedRanges.length} ranges in ${(performance.now() - t0).toFixed(0)}ms.`)

	/** DEBUG / Sanity */
	const mergedSize = rangesSize(mergedRanges, 'merged')
	if (mergedSize > originalSize) throw new Error(`merged size cannot be bigger than original size, ${originalSize} > ${mergedSize}.`)

	return mergedRanges;
}

/** 
 * extra debugging checks and info 
 */

/** get length of ranges */
const rangesSize = (ranges: Array<ByteRange>, id: string) => {
	const t0 = performance.now()
	let total = 0
	let longest = 0
	for (const range of ranges) {
		const diff = range[1] - range[0]
		if (diff > longest) longest = diff
		total += diff
	}
	console.debug(id,
		'total', total.toLocaleString(),
		'longest', longest.toLocaleString(),
		`in ${(performance.now() - t0).toFixed(0)} ms`
	)
	return total
}