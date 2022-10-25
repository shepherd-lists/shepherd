import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { updateTxsDb } from '../common/utils/db-update-txs'
import { ByteRange, txidToRange } from './txidToRange/txidToRange'
import { slackLogger } from '../common/utils/slackLogger'


export const byteRanges = async (id: string, parent: string|null) => {

	/* get byte-range (if applicable) */

	let chunkRange: ByteRange = { start: -1n, end: -1n }
	try{
		chunkRange = await txidToRange(id, parent)
	}catch(e:any){
		logger(byteRanges.name, "UNHANLDED error", e.name, e.message, e)
		slackLogger(byteRanges.name, "UNHANLDED error", e.name, e.message)
	}

	/* update database - (expensive to do this separately, consider combined operation) */

	const checkId = await updateTxsDb(id, {
		byteStart: chunkRange.start.toString(),
		byteEnd: chunkRange.end.toString(), 
	})
	if(checkId !== id){
		throw new Error(`Error writing byte-range to database! Wanted '${id}'. Returned '${checkId}'.`)
	}

	return chunkRange;
}


