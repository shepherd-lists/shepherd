import { Knex } from "knex"
import { logger } from "../common/shepherd-plugin-interfaces/logger"
import { TxRecord } from "../common/shepherd-plugin-interfaces/types"
import dbConnection from "../common/utils/db-connection"
import { slackLogger } from "../common/utils/slackLogger"

const knex = dbConnection()

/* batch move records from inbox_txs to txs tables */
export const moveInboxToTxs = async (txids: string[]) => {

	/** 
	 * Temporarilly adding an onConflict-merge here.
	 * this is to prevent duplicate key error when initially switching over to the new tables layout
	 * */

	let trx: Knex.Transaction<any, any[]> | null = null // keep TS happy
	try {
		trx = await knex.transaction()
		const res = await trx('txs')
		.insert( 
			knex<TxRecord>('inbox_txs').select('*').whereIn('txid', txids) 
		)
		.onConflict('txid').merge([
			'txid', 
			'content_type', 
			'content_size', 
			'flagged', 
			'valid_data', 
			'data_reason', 
			'last_update_date', 
			'height', 
			'flag_type', 
			'top_score_name', 
			'top_score_value', 
			'parent', 
			'byteStart', 
			'byteEnd', 
			'parents', 
		])
		.returning('txid')

		await trx.delete().from('inbox_txs').whereIn('txid', txids)
		await trx.commit()

		/** remove this error if it becomes inappropriate (check flagged record moving though)  */
		if(res.length !== txids.length){
			throw new Error(`expected ${txids.length} records to be moved, but only ${res.length} were moved`)
		}

		return res.length;
	} catch (e) {
		logger(moveInboxToTxs.name, `error moving record ${txids} from inbox_txs to txs`, e)
		slackLogger(moveInboxToTxs.name, `error moving record ${txids} from inbox_txs to txs`, JSON.stringify(e))
		if(trx){ // keep TS happy
			await trx.rollback()
		}
		throw e
	}
}

