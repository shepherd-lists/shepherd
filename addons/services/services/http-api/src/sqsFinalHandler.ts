import { getByteRange } from '../../../libs/byte-ranges/byteRanges'
import { checkTxFresh, dbCorruptDataConfirmed, dbCorruptDataMaybe, dbOversizedPngFound, dbPartialImageFound, dbUnsupportedMimeType, insertTxsDb } from './utils/db-insert-txs'
import { slackLog } from '../../../libs/utils/slackLog'
import { slackLogPositive } from './utils/slackLogPositive'
import { processFlagged } from './flagged'
import { TxRecord } from 'shepherd-plugin-interfaces/types'



let count = 0
export const sqsFinalHandler = async (txid: string, record: TxRecord) => {

	const c = ++count
	console.info(txid, `handler begins. count ${c}`)

	try {

		if (record.flagged !== undefined) {
			if (record.flagged === true && record.flag_type === 'matched') {
				slackLogPositive('flagged', JSON.stringify(record))
			}
			if (record.flag_type === 'test') {
				slackLog('✅ *Test Message* ✅', JSON.stringify(record))
			}
			if (record.flag_type === 'classified' && Number(record.top_score_value) > 0.9 && record.top_score_name === 'csam' && await checkTxFresh(txid)) {
				//we use checkTxFresh so as not to bombard Slack during SQS retries and recheck cronjobs

				slackLog(`:warning: *!!! classified !!!* :warning: \`${txid}\``, JSON.stringify(record))
			}

			let byte_start, byte_end
			if (
				Number(record.top_score_value) > 0.9
				|| record.flagged === true
			) {
				try {
					if (!record.byte_start || record.byte_start === '-1') {
						/** calculate the byte range */
						const { start, end } = await getByteRange(txid, record.parent, record.parents)
						byte_start = start.toString()
						byte_end = end.toString()

						console.info(txid, `calculated byte-range ${byte_start} to ${byte_end}`, `owner: ${record.owner}`)
					}
				} catch (err: unknown) {
					const e = err as Error
					slackLog(txid, sqsFinalHandler.name, `Error calculating byte-range: ${e.name}:${e.message}`, JSON.stringify(e))
					// keey going. byte-ranges remain null => gets retried elsewhere in a fallback
				}
			}

			/** prepare record updates */
			const updates: TxRecord = {
				...record, //original record
				flagged: record.flagged,
				valid_data: true,
				...(record.flag_type && { flag_type: record.flag_type }),
				...(record.top_score_name && { top_score_name: record.top_score_name }),
				...(record.top_score_value && { top_score_value: record.top_score_value }),
				...(byte_start && { byte_start, byte_end }),
				last_update_date: new Date(),
			}
			if (record.flagged === true && (!record.flag_type || record.flag_type === 'matched')) {
				/** to explain the above expression: 
				 * a. some addons dont use flag_type (e.g. nsfw), in that case just process them all
				 * b. if flag_type in use only automatically process `matched` results */

				return processFlagged(txid, record!, updates)

			} else {//flagged===false
				await insertTxsDb(txid, updates)
			}

		} else if (record.data_reason === undefined) {
			throw new TypeError('data_reason and flagged cannot both be undefined')
		} else {
			switch (record.data_reason) {
				case 'corrupt':
					await dbCorruptDataConfirmed(record) //this is not an error
					break
				/** less than ideal to get to any of these 4 db updates below. 
				 * that means the classifier pipeline failed to process these files. */
				case 'corrupt-maybe':
					await dbCorruptDataMaybe(record)
					break
				case 'oversized':
					await dbOversizedPngFound(record)
					break
				case 'partial':
					await dbPartialImageFound(record)
					break
				case 'unsupported':
					await dbUnsupportedMimeType(record)
					break

				default:
					slackLog(sqsFinalHandler.name, 'UNHANDLED plugin result', txid)
					throw new Error(`UNHANDLED plugin result in http-api:\n` + JSON.stringify(record))
			}
		}
	} finally {
		// await dbInflightDel(txid)
		console.info(txid, `handler finished. count ${c}`)
	}
}

