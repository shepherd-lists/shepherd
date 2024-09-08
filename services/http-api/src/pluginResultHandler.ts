import { getByteRange } from '../../../libs/byte-ranges/byteRanges'
import { APIFilterResult } from 'shepherd-plugin-interfaces'
import { checkTxFresh, dbCorruptDataConfirmed, dbCorruptDataMaybe, dbInflightDel, dbOversizedPngFound, dbPartialImageFound, dbUnsupportedMimeType, dbWrongMimeType, getTxFromInbox, updateInboxDb } from './utils/db-update-txs'
import { slackLog } from '../../../libs/utils/slackLog'
import { slackLogPositive } from '../../../libs/utils/slackLogPositive'
import { moveInboxToTxs } from './move-records'
import { doneAdd } from './done-records'
import { processFlagged } from './flagged'
import { TxRecord } from 'shepherd-plugin-interfaces/types'



let count = 0
export const pluginResultHandler = async (body: APIFilterResult) => {
	const txid = body.txid
	const result = body.filterResult

	const c = ++count
	console.info(txid, `handler begins. count ${c}`)

	if ((typeof txid !== 'string') || txid.length !== 43) {
		console.error('Fatal error', `txid is not defined correctly: ${body?.txid}`)
		throw new TypeError('txid is not defined correctly')
	}

	try {

		if (result.flagged !== undefined) {
			if (result.flagged === true) {
				if (result.flag_type === 'matched') {
					slackLogPositive('flagged', JSON.stringify(body))
				} else if (result.flag_type === 'classified' && await checkTxFresh(txid)) {
					//we use checkTxFresh so as not to bombard Slack during SQS retries and recheck cronjobs

					/** these currently don't get automatically processed, need to check these warnings */
					result.flagged = false
					slackLog(`:warning: *!!! classified !!!* :warning: \`${txid}\``, JSON.stringify(result))
				}
			}
			if (result.flag_type === 'test') {
				slackLog('✅ *Test Message* ✅', JSON.stringify(body))
			}

			let byteStart, byteEnd, record
			if (
				Number(result.top_score_value) > 0.9
				|| result.flagged === true
			) {
				try {
					/** get the tx data from the database */
					record = await getTxFromInbox(txid)

					/** sqs messages can be read more than once */
					if (!record) {
						console.info(txid, pluginResultHandler.name, 'record not found in inbox. assuming multi read of sqs mesg', JSON.stringify(result))
						return
					}

					/** calculate the byte range */
					const { start, end } = await getByteRange(txid, record.parent, record.parents)
					byteStart = start.toString()
					byteEnd = end.toString()

					console.log(txid, `calculated byte-range ${byteStart} to ${byteEnd}`, `owner: ${record.owner}`)
				} catch (err: unknown) {
					const e = err as Error
					slackLog(txid, pluginResultHandler.name, `Error calculating byte-range: ${e.name}:${e.message}`, JSON.stringify(e))
					// keey going. byte-ranges remain null => gets retried elsewhere in a fallback
				}
			}

			/** prepare record updates */
			const updates: Partial<TxRecord> = {
				flagged: result.flagged,
				valid_data: true,
				...(result.flag_type && { flag_type: result.flag_type }),
				...(result.top_score_name && { top_score_name: result.top_score_name }),
				...(result.top_score_value && { top_score_value: result.top_score_value }),
				...(byteStart && { byteStart, byteEnd }),
				last_update_date: new Date(),
			}
			if (result.flagged === true && (!result.flag_type || result.flag_type === 'matched')) {
				/** to explain the above expression: 
				 * a. some addons dont use flag_type (e.g. nsfw), in that case just process them all
				 * b. if flag_type in use only automatically process `matched` results */

				return processFlagged(txid, record!, updates)

			} else {//flagged===false
				const res = await updateInboxDb(txid, updates)

				/** this check should either occur here or in the updateDb function, not both */
				if (res !== txid) {
					slackLog('Fatal error', `Could not update database. "${res} !== ${txid}"`)
					throw new Error('Could not update database')
				}

				await doneAddTested(txid)
			}

		} else if (result.data_reason === undefined) {
			console.error(txid, 'data_reason and flagged cannot both be undefined. deleting from inflights.')
			await dbInflightDel(txid)
			throw new TypeError('data_reason and flagged cannot both be undefined')
		} else {
			switch (result.data_reason) {
				case 'corrupt-maybe':
					await dbCorruptDataMaybe(txid)
					break
				case 'corrupt':
					await dbCorruptDataConfirmed(txid)
					break
				case 'oversized':
					await dbOversizedPngFound(txid)
					break
				case 'partial':
					await dbPartialImageFound(txid)
					break
				case 'unsupported':
					await dbUnsupportedMimeType(txid)
					break
				case 'mimetype':
					await dbWrongMimeType(txid, result.err_message!)
					break
				case 'retry':
					await dbInflightDel(txid) //this is all we actually want done
					return

				default:
					slackLog(pluginResultHandler.name, 'UNHANDLED plugin result in http-api', txid)
					throw new Error('UNHANDLED plugin result in http-api:\n' + JSON.stringify(result))
			}
			await doneAddTested(txid)
		}
	} finally {
		// await dbInflightDel(txid)
		console.info(txid, `handler finished. count ${c}`)
	}
}

const doneAddTested = async (txid: string) => {
	const record = await getTxFromInbox(txid)
	if (record) {
		if (record.flagged !== undefined || record.valid_data !== undefined) {
			console.info(txid, 'flagged or valid_data set. calling doneAdd')
			await doneAdd(txid, record.height)
		} else {
			console.info(txid, 'flagged or valid_data not set.')
		}
	}
}
