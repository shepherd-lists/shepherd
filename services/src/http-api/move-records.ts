import { Knex } from "knex"
import { logger } from "../common/shepherd-plugin-interfaces/logger"
import { TxRecord } from "../common/shepherd-plugin-interfaces/types"
import dbConnection from "../common/utils/db-connection"
import { slackLogger } from "../common/utils/slackLogger"

const knex = dbConnection()

/* batch move records from inbox to txs tables */
export const moveInboxToTxs = async (txids: string[]) => {

	/** 
	 * Adding (temporarilly?) an onConflict-merge here.
	 * this is to:
	 * - prevent duplicate key error when initially switching over to the new tables layout
	 * - also used when doing pass2 on a flagged record, should be rare enough
	 * */

	/** consider upgrading this "typechecking". zod? class? */
	type TxRecordKeys = (keyof TxRecord)[]
	const allTxRecordKeys: TxRecordKeys = [
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
	]

	let trx: Knex.Transaction
	try{
		trx = await knex.transaction()
		const res = await trx('txs')
		.insert( 
			knex<TxRecord>('inbox').select('*')
			.whereIn('txid', txids)
			.where(function(){
				this
				.whereNotNull('valid_data') // for no-data done records that get reset
				.orWhereNotNull('flagged') // future use
			})
		)
		.onConflict('txid').merge(allTxRecordKeys)
		.returning('txid')

		/** only remove what's been inserted */
		const insertedIds = res.map(r => r.txid) as string[]

		/** this is now the main place where inflight removal happens */
		await trx.delete().from('inflights').whereIn('txid', insertedIds)	
		await trx.delete().from('inbox').whereIn('txid', insertedIds)
		await trx.commit()

		logger(moveInboxToTxs.name, `moved ${res.length} records from inbox to txs`)

		return res.length;
	}catch (e) {
		logger(moveInboxToTxs.name, `error moving record ${txids} from inbox to txs`, e)
		slackLogger(moveInboxToTxs.name, `error moving record ${txids} from inbox to txs`, JSON.stringify(e))
		await trx!.rollback()
		throw e
	}
}

