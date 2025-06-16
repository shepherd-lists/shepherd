import { createMutex } from '../utils/mutex'
import { ByteRange, mergeErlangRanges } from './merge-ranges'
import { idToBase32 } from '../utils/id-to-base32'


/** txids are pretty basic */
export interface TxidItem {
	id: string
	base32: string
}
export const uniqTxidArray = () => {
	const items: TxidItem[] = []
	const itemSet = new Set<string>() //faster checks

	const add = (id: string) => {
		if (!itemSet.has(id)) {
			items.push({ id, base32: idToBase32(id) })
			itemSet.add(id)
		}
	}
	const remove = (id: string) => {
		if (itemSet.has(id)) {
			items.splice(items.findIndex(item => item.id === id), 1)
			itemSet.delete(id)
		}
	}
	const getTxids = () => items

	return { add, remove, getTxids }
}
export type UniqTxidArray = ReturnType<typeof uniqTxidArray>


/** we've got to be careful that the output state represents the merged ranges in order of adding/removal */
export const normalizedRanges = () => {
	const mutex = createMutex()
	let ranges: ByteRange[] = []
	let dirty = false

	/** dirty add multiple ranges */
	const add = async (newRanges: ByteRange[]) => mutex.acquireLock((addRanges: ByteRange[]) => {
		dirty = true
		ranges.push(...addRanges)
	}, newRanges)


	// Function to remove multiple ranges from the current state
	const remove = async (removing: ByteRange[]) => mutex.acquireLock((rangesToRemove: ByteRange[]) => {

		dirty = true

		for (const [removeStart, removeEnd] of rangesToRemove) {
			const updatedRanges: ByteRange[] = []

			for (const [rStart, rEnd] of ranges) {
				if (rEnd < removeStart || rStart > removeEnd) {
					// No overlap, keep the existing range
					updatedRanges.push([rStart, rEnd])
				} else {
					// Handle overlapping parts
					if (rStart < removeStart) {
						updatedRanges.push([rStart, removeStart])
					}
					if (rEnd > removeEnd) {
						updatedRanges.push([removeEnd, rEnd])
					}
				}
			}

			// Update the main ranges with the modified state
			ranges = updatedRanges
		}


	}, removing)

	// Function to get the latest version of all ranges
	const getRanges = async () => mutex.acquireLock(() => {
		if (dirty) {
			ranges = mergeErlangRanges(ranges)
			dirty = false
			return ranges
		}
		return ranges //this should be the most common case
	})

	return {
		add,
		remove,
		getRanges,
	}
}
export type NormalizedRanges = ReturnType<typeof normalizedRanges>

