import { TxRecord } from 'shepherd-plugin-interfaces/types'
import dbConnection from '../../../libs/utils/knexCreate'
import { slackLog } from '../../../libs/utils/slackLog'
import { createInfractionsTable, ownerToInfractionsTablename, ownerToOwnerTablename } from '../../../libs/block-owner/owner-table-utils'
import { infraction_limit } from '../../../libs/constants'
import { blockOwnerHistory } from '../../../libs/block-owner/owner-blocking'
import { updateAddresses, updateFullTxidsRanges } from '../../../libs/s3-lists/update-lists'

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
	 * 2. owner update
	 * - update owners_list
	 * - schedule blocking if necessary
	 * 3. update s3
	*/

	let infractions = 0
	const owner = record.owner!
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
			await slackLog(txid, 'ERROR ❌ cannot insert flagged to txs', `(${JSON.stringify(updates)}) => ${resInsert}`)
			throw new Error(`Could not insert ${txid} into txs`) //cause a rollback
		}

		/** 2. owner update */
		/** update owners_list */
		const infractionsTablename = ownerToInfractionsTablename(owner)
		const ownerRecord = await trx('owners_list').where('owner', owner).first()

		if (ownerRecord) {
			infractions = ownerRecord.infractions
		} else {
			await createInfractionsTable(owner, trx)
		}
		const alreadyExists = await trx(infractionsTablename).where('txid', txid).first()
		if (!alreadyExists) {
			infractions++
			await trx(infractionsTablename).insert({ txid })
		} else {
			await slackLog(txid, 'ERROR ❌ already exists in infractions', `(${JSON.stringify(updates)}) => ${resInsert}`)
			throw new Error(`Already exists in infractions`) //cause a rollback
		}

		if (ownerRecord) {
			await trx('owners_list').where('owner', owner).update({ infractions })
		} else {
			await trx('owners_list').insert({ owner, infractions, add_method: 'auto' })
		}

		await trx.commit()
	} catch (e) {
		trx.rollback()
		throw e // will this cause client to retry?
	}

	/** schedule blocking if necessary */
	if (infractions > infraction_limit) {
		await blockOwnerHistory(owner) // cannot rollback!

		/** update s3://addresses.txt */
		await updateAddresses() //needs to be commited 
	}

	/** update s3-lists. this causes a full re-write. use sparingly */
	await updateFullTxidsRanges()

}
