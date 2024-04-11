import { TxRecord } from 'shepherd-plugin-interfaces/types'
import dbConnection from '../../../libs/utils/knexCreate'
import { slackLog } from '../../../libs/utils/slackLog'
import { ownerToInfractionsTablename, ownerToOwnerTablename } from '../../../libs/block-owner/owner-table-utils'
import { infraction_limit } from '../../../libs/constants'
import { queueBlockOwner } from '../../../libs/block-owner/owner-blocking'
import { updateAddresses, updateFullTxidsRanges } from '../../../libs/s3-lists/update-lists'
import moize from 'moize'


const knex = dbConnection()

/** slightly unconventional use of moize. we're using it to ensure any table is only created once.
 * - we just need to mitigate any race conditions between calls to `hasTable(owner_X)` and `createTable(owner_X)`.
 */
const createInfractionsTable = moize(
	async (owner: string) => {
		const tablename = ownerToInfractionsTablename(owner)

		if (await knex.schema.hasTable(tablename)) return tablename

		await knex.schema.createTable(tablename, table => {
			table.specificType('txid', 'char(43)').primary()
			table.dateTime('last_update').defaultTo(knex.fn.now())
		})
		return tablename
	}, {
	isPromise: true,
	maxSize: 50, // should be plenty
})

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
	 * - ignore whitelisted owners
	 * - schedule blocking if necessary
	 * 3. update s3
	*/

	let infractions = 0
	const owner = record.owner!

	/** ensure table is created before we start the trx (race conditions) */
	await createInfractionsTable(owner)

	const trx = await knex.transaction()
	try {
		/** 1. item specific */
		/** remove from inbox/inflights */
		await trx('inflights')
			.delete()
			.where('txid', txid)

		/** update tx in db */
		await trx<TxRecord>('inbox')
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
	} catch (err: unknown) {
		trx.rollback()
		const e = err as Error & { code?: string }
		if (e.code && +e.code === 23505) {
			await slackLog(txid, 'verify this! =>  duplicate entry in infractions table due to sqs dupe.')
			return;
		}
		throw e // this will cause service to fatally crash!
	}

	/** schedule blocking if necessary */
	if (infractions === infraction_limit + 1) {	// don't run block-owner-history more than once?

		/** check if whitelisted */
		const whitelisted = await knex('owners_whitelist').where({ owner }).first()

		if (whitelisted) {
			slackLog(processFlagged.name, `${owner} is whitelisted, not blocking`)
		} else {
			slackLog(processFlagged.name, `:warning: started blocking owner: ${owner} with ${infractions} infractions. (KEEP AN EYE ON NOTIFICATIONS!)`)
			const numBlocked = await queueBlockOwner(owner, 'auto') // cannot rollback. most likely will not queue and run immediately.
			slackLog(processFlagged.name, `:white_check_mark: finished ${queueBlockOwner.name}: blocked ${numBlocked} items from ${owner}`)

			/** update s3://addresses.txt */
			await updateAddresses() //needs to be commited 
		}

	}

	/** update s3-lists. this causes a full re-write. use sparingly */
	await updateFullTxidsRanges()

}
