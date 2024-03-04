import { TxRecord } from 'shepherd-plugin-interfaces/types'
import dbConnection from '../../../libs/utils/knexCreate'
import { slackLog } from '../../../libs/utils/slackLog'

const knex = dbConnection()



export const processFlagged = async (
	txid: string,
	record: TxRecord,
	updates: Partial<TxRecord>,
) => {

	/** steps (use a trx):
	 * 1. item specific
	 * - update tx in db
	 * -- remove from inbox/inflights
	 * -- insert to txs
	 * - update s3 with query
	 * 2. owner update
	 * - update owners_list
	 * - schedule blocking if necessary
	 */

	const trx = await knex.transaction()
	try {
		/** 1. item specific */
		/** update tx in db */
		await trx<TxRecord>('inbox')
			.delete()
			.where('txid', txid)

		/** remove from inbox/inflights */
		await trx('inflights')
			.delete()
			.where('txid', txid)

		/** insert to txs */
		const resInsert = await trx('txs')
			.insert({ ...record, ...updates })
			// .onConflict('txid').merge() this just shouldn't happen
			.returning('txid')
		const insertedId = resInsert[0]?.txid
		if (insertedId !== txid) {
			await slackLogger(txid, 'ERROR ❌ cannot insert flagged to txs', `(${JSON.stringify(updates)}) => ${resInsert}`)
		}
		/** 2. owner update */
		/** update owners_list */
		/** schedule blocking if necessary */

		await trx.commit()
	} catch (e) {
		trx.rollback()
		throw e
	}

}