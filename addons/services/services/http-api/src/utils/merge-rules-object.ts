import { Knex } from 'knex'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import dbConnection from '../../../../libs/utils/knexCreate'

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
		'byte_start',
		'byte_end',
		'parents',
		'owner',
	]

	/** ensure new null column values overwrite existing data, special case for byte-ranges */
	const updateObject: Record<string, Knex.Raw> = {}

	allTxRecordKeys.forEach(k => {
		if (k === 'byte_start' || k === 'byte_end') { //special cases
			updateObject[k] = knex.raw(
				`CASE
					WHEN EXCLUDED.?? IS NOT NULL AND EXCLUDED.??::bigint != -1 
					THEN EXCLUDED.??
					ELSE txs.??
				END
				`, [k, k, k, k])
		} else if (k === 'flagged') {
			// Once flagged is true, it cannot be changed to any other state
			updateObject[k] = knex.raw(
				`CASE
					WHEN txs.?? = true THEN true
					ELSE EXCLUDED.??
				END
				`, [k, k])
		} else {
			updateObject[k] = knex.raw('EXCLUDED.??', [k])
		}
	})

	return updateObject;
}


