import { Knex } from "knex"
import { logger } from "../common/shepherd-plugin-interfaces/logger"
import { TxRecord } from "../common/shepherd-plugin-interfaces/types"
import dbConnection from "../common/utils/db-connection"
import { slackLogger } from "../common/utils/slackLogger"

const knex = dbConnection()

/* batch move records from inbox_txs to txs tables */
export const moveInboxToTxs = async (txids: string[]) => {

	let trx: Knex.Transaction<any, any[]> | null = null // keep TS happy
	try {
		trx = await knex.transaction()
		const res = await trx('txs').insert( knex<TxRecord>('inbox_txs').select('*').whereIn('txid', txids) ).returning('txid')
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
