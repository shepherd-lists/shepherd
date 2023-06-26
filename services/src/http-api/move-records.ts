import { logger } from "../common/shepherd-plugin-interfaces/logger"
import { TxRecord } from "../common/shepherd-plugin-interfaces/types"
import dbConnection from "../common/utils/db-connection"
import { slackLogger } from "../common/utils/slackLogger"

const knex = dbConnection()

/* use a transaction and the COPY to move a record from inbox_txs to txs */
export const moveInboxToTxs = async (txids: string[]) => {
	await knex.transaction(async trx => { 
		try {
			const res = await trx('txs').insert( knex<TxRecord>('inbox_txs').select('*').whereIn('txid', txids) ).returning('txid')
			await trx.delete().from('inbox_txs').whereIn('txid', txids)
			await trx.commit()
			return res.length
		} catch (e) {
			logger(moveInboxToTxs.name, `error moving record ${txids} from inbox_txs to txs`, e)
			slackLogger(moveInboxToTxs.name, `error moving record ${txids} from inbox_txs to txs`, JSON.stringify(e))
			await trx.rollback()
			throw e
		}
	})
}