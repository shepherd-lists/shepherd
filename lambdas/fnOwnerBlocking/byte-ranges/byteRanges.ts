import { ByteRange, txidToRange } from './txidToRange/txidToRange'
import { slackLog } from '../utils/slackLog'


/** just returns the byte-range for the id */
export const getByteRange = async (id: string, parent: string | null, parents: string[] | undefined) => {

	/* get byte-range (if applicable) */

	let chunkRange: ByteRange = { start: -1n, end: -1n }
	try {
		chunkRange = await txidToRange(id, parent, parents)
	} catch (err: unknown) {
		const e = err as Error
		slackLog(getByteRange.name, 'UNHANLDED error', e.name, e.message, `id:${id}, parent:${parent}, parents:${parents}}`)
	}

	return chunkRange
}

