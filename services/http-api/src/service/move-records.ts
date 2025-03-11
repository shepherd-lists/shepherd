import { Knex } from 'knex'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import dbConnection from '../../../../libs/utils/knexCreate'
import { slackLog } from '../../../../libs/utils/slackLog'

const knex = dbConnection()

/** we need this object for applying merge-conflict rules. 
 * 
 * also used in 'flagged.ts'
 *  
 */
export const mergeRulesObject = () => {
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
		'owner',
	]

	/** ensure new null column values overwrite existing data, special case for byte-ranges */
	const updateObject: Record<string, Knex.Raw> = {}

	allTxRecordKeys.forEach(k => {
		if (k === 'byteStart' || k === 'byteEnd') { //special cases
			updateObject[k] = knex.raw(
				`CASE
					WHEN EXCLUDED.?? IS NOT NULL AND EXCLUDED.??::bigint != -1 
					THEN EXCLUDED.??
					ELSE txs.??
				END
				`, [k, k, k, k])
		} else {
			updateObject[k] = knex.raw('EXCLUDED.??', [k])
		}
	})

	return updateObject;
}

/* batch move records from inbox to txs tables */
export const moveInboxToTxs = async (txids: string[]) => {

	/**
	 * Adding an onConflict-merge here.
	 * this is to prevent duplicate key error when:
	 * - doing extra passes on records
	 * - initially switching over to the new inbox/txs tables layout
	 * */


	let trx: Knex.Transaction
	try {
		trx = await knex.transaction()
		const sql = trx('txs')
			.insert(
				knex<TxRecord>('inbox').select('*')
					.whereIn('txid', txids)
					.where(function () {
						this
							.whereNotNull('valid_data') // for no-data done records that get reset
							.orWhereNotNull('flagged') // future use
					})
			)
			.onConflict('txid').merge(mergeRulesObject())
			.returning('txid')
		// console.debug(sql.toSQL())
		const res = await sql


		/** only remove what's been inserted */
		const insertedIds = res.map(r => r.txid) as string[]

		/** this is now the main place where inflight removal happens */
		await trx.delete().from('inflights').whereIn('txid', insertedIds)
		await trx.delete().from('inbox').whereIn('txid', insertedIds)
		await trx.commit()

		console.info(moveInboxToTxs.name, `moved ${res.length} records from inbox to txs`, JSON.stringify(insertedIds))

		return res.length
	} catch (e) {
		slackLog(moveInboxToTxs.name, `error moving record ${txids} from inbox to txs`, JSON.stringify(e))
		await trx!.rollback()
		throw e
	}
}

