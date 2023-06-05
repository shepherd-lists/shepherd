import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { updateTxsDb } from '../common/utils/db-update-txs'
import { ByteRange, txidToRange } from './txidToRange/txidToRange'
import { slackLogger } from '../common/utils/slackLogger'


/** this is used in retrospective syncing */
export const byteRangesUpdateDb = async (id: string, parent: string | null, parents: string[] | undefined) => {

	/* update database - (expensive to do this separately, consider combined operation) */

	const chunkRange = await getByteRange(id, parent, parents)

	/** rare retrospective update, so go direct to output table */
	const checkId = await updateTxsDb(id, {
		byteStart: chunkRange.start.toString(),
		byteEnd: chunkRange.end.toString(), 
	})
	if(checkId !== id){
		throw new Error(`Error writing byte-range to database! Wanted '${id}'. Returned '${checkId}'.`)
	}

	return chunkRange;
}

/** just returns the byte-range for the id */
export const getByteRange = async (id: string, parent: string | null, parents: string[] | undefined) => {

		/* get byte-range (if applicable) */

		let chunkRange: ByteRange = { start: -1n, end: -1n }
		try{
			chunkRange = await txidToRange(id, parent, parents)
		}catch(e:any){
			logger(byteRangesUpdateDb.name, "UNHANLDED error", e.name, e.message, `id:${id}, parent:${parent}, parents:${parents}}`, e)
			slackLogger(byteRangesUpdateDb.name, "UNHANLDED error", e.name, e.message, `id:${id}, parent:${parent}, parents:${parents}}`)
		}

		return chunkRange;
}

