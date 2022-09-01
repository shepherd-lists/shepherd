import { logger } from '../common/utils/logger'
import { updateTxsDb } from '../common/utils/db-update-txs'
import dbConnection from '../common/utils/db-connection'
import { ByteRange, txidToRange } from './txidToRange/txidToRange'
import { slackLogger } from '../common/utils/slackLogger'

const knex = dbConnection()


const CHUNK_ALIGN_GENESIS = 30607159107830n //weave address where enforced 256kb chunks started
const CHUNK_SIZE = 262144n //256kb

/**
 * ** THIS IS MVP ONLY FOR NOW **
 * 
 * It needs to be cleaned up! For example:
 * - we dont really need to be holding an entire ans104 bundle in ram.
 * - we can stream the header and cancel the rest of the download - need to process the binary header ourselves.
 * - this only supports the current ans104 bundle standard. missing ans102 (and previous versions?).
 * 
 * @param wantedId the id of the dataItem we want byte ranges for.
 * @returns (for test only) the byte range of the dataItem in weave data aligned to chunk boundaries
 */
export const byteRanges = async (id: string) => {

	/* get byte-range (if applicable) */

	let chunkRange: ByteRange = { start: -1n, end: -1n }
	try{
		chunkRange = await txidToRange(id)
	}catch(e:any){
		logger(byteRanges.name, "UNHANLDED error", e.name, e.message, e)
		slackLogger(byteRanges.name, "UNHANLDED error", e.name, e.message)
	}

	/* update database - (expensive to do this separetely, consider combined operation) */

	const checkId = await updateTxsDb(id, {
		byteStart: chunkRange.start.toString(),
		byteEnd: chunkRange.end.toString(), 
	})
	if(checkId !== id){
		throw new Error(`Error writing byte-range to database! Wanted '${id}'. Returned '${checkId}'.`)
	}

	return chunkRange; //used for test
}


