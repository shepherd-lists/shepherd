import { ByteRange } from "./update-lists";



export const mergeRanges = (ranges: Array<ByteRange>) => {

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
			if (nextStart <= currentEnd + 1) {
				// Update the end of the current range in the mergedRanges array
				currentRange[1] = Math.max(currentEnd, nextEnd)
			} else {
				// If not overlapping or adjacent, move to the next range
				currentRange = range
				mergedRanges.push(currentRange)
			}
		})
	}

	console.info(mergeRanges.name, `sorted & merged ${ranges.length} ranges to ${mergedRanges.length} ranges in ${(performance.now() - t0).toFixed(0)}ms.`)

	return mergedRanges;
}