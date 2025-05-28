import { TxRecord } from 'shepherd-plugin-interfaces/types'
import dbConnection from '../../../libs/utils/knexCreate'
import { slackLog } from '../../../libs/utils/slackLog'
import { ownerToInfractionsTablename } from '../../../libs/block-owner/owner-table-utils'
import { infraction_limit } from '../../../libs/constants'
import { queueBlockOwner } from '../../../libs/block-owner/owner-blocking'
import { UpdateItem, updateS3Lists } from '../../../libs/s3-lists/update-lists'
import { updateAddresses } from '../../../libs/s3-lists/update-addresses'
import { OwnersListRecord } from '../../../types'
import { mergeRulesObject } from './service/move-records'
import { lambdaInvoker } from '../../../libs/utils/lambda-invoker'


const knex = dbConnection()
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


/** utility function. beware of potential race-condition between hasTable & createTable. 
 * @description exported for test only 
 */
export const createInfractionsTable = async (owner: string) => {
	const tablename = ownerToInfractionsTablename(owner)

	if (await knex.schema.hasTable(tablename)) return tablename

	await knex.schema.createTable(tablename, table => {
		table.specificType('txid', 'char(43)').primary()
		table.dateTime('last_update').defaultTo(knex.fn.now())
	})
	return tablename
}


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

	const owner = record.owner!
	const completedRecord = { ...record, ...updates }


	const trx = await knex.transaction()
	try {
		/** 1. item specific */
		/** remove from inbox/inflights */
		await trx('inflights')
			.delete()
			.where('txid', txid)
		await trx<TxRecord>('inbox')
			.delete()
			.where('txid', txid)

		/** insert to txs */
		const resInsert = await trx('txs')
			.insert(completedRecord)
			.onConflict('txid').merge(mergeRulesObject())
			.returning('txid')
		const insertedId = resInsert[0]?.txid
		if (insertedId !== txid) {
			await slackLog(txid, 'ERROR ❌ cannot insert flagged to txs', `(${JSON.stringify(updates)}) => ${resInsert}`)
			throw new Error(`Could not insert ${txid} into txs`) //cause a rollback
		}

		/** update s3 lists: `list/` & `flagged/` */
		const s3Record: UpdateItem = { txid, range: [Number(completedRecord.byte_start), Number(completedRecord.byte_end)] }
		await updateS3Lists('list/', [s3Record])
		await updateS3Lists('flagged/', [s3Record])

		/** TEMPORARY UNTIL LIST MIGRATION IS COMPLETE */
		await lambdaInvoker(process.env.FN_TEMP!, {})

		await trx.commit()
	} catch (err: unknown) {
		await trx.rollback()
		await slackLog(`FATAL ERROR ❌ in ${processFlagged.name} ROLLBACK flagged => ${txid}`)
		throw err // this will cause service to fatally crash!
	}

	/** 2. owner update */
	try {

		await ownerUpdate(owner, txid)

	} catch (err: unknown) {
		const e = err as Error & { code?: string }
		if (e.code && +e.code === 23505) {
			await slackLog(txid, 'verify this! =>  duplicate entry in infractions table due to sqs dupe.')
			return;
		}
		throw e // this will cause service to fatally crash!
	}

}

/** can only have one txid from same owner perform infraction processing etc at same time.
 * we'll delete the k,v to release lock. ensures no memory leak.
 */
const _writeLock: { [owner: string]: boolean } = {}
const ownerUpdate = async (owner: string, txid: string) => {
	/** attain write-lock */
	while (_writeLock[owner])
		await sleep(100)
	_writeLock[owner] = true


	/** update owners_list */
	let infractions = 0
	let trx = await knex.transaction()

	try {
		await createInfractionsTable(owner)

		const infractionsTablename = ownerToInfractionsTablename(owner)
		let ownerRecord = await trx<OwnersListRecord>('owners_list').where('owner', owner).first()

		if (ownerRecord) {
			infractions = ownerRecord.infractions
		}

		const alreadyExists = await trx(infractionsTablename).where('txid', txid).first()
		if (!alreadyExists) {
			infractions++
			await trx(infractionsTablename).insert({ txid })
		} else {
			await slackLog(txid, 'ERROR ❌ already exists in infractions. should be SQS dupe, CHECK!',) //`(${JSON.stringify(updates)}) => ${resInsert}`)
			throw new Error(`Already exists in infractions`) //cause a rollback
		}

		if (ownerRecord) {
			await trx('owners_list').where('owner', owner).update({ infractions })
		} else {
			const inserted = await trx<OwnersListRecord>('owners_list').insert({ owner, infractions, add_method: 'auto' }).returning('*')
			ownerRecord = inserted[0]
		}

		/* needs to be commited before calling lambdas which use created tables and entries */
		await trx.commit()

		/** schedule blocking if necessary */
		if (infractions >= infraction_limit && ownerRecord.add_method === 'auto') {	// don't run block-owner-history more than once?

			/** check if whitelisted */
			const whitelisted = await knex('owners_whitelist').where({ owner }).first()

			if (whitelisted) {
				slackLog(processFlagged.name, `${owner} is whitelisted, not blocking`)
			} else {
				/* add to queue */
				const added = await queueBlockOwner(owner, 'auto')
				if (added) {
					//TODO: move all of this inside queueBlockOwner
					/* get infraction records for notification */
					const infractionRecs = await knex<TxRecord>('txs').whereIn('txid', function () {
						this.select('txid').from(infractionsTablename)
					})
					slackLog(processFlagged.name, `:warning: started blocking owner: ${owner} with ${infractions} infractions. ${txid}`, JSON.stringify(infractionRecs, null, 2))
				}

				/** update s3://addresses.txt */
				//TODO: this should be called internally
				await updateAddresses()
			}
		}

	} catch (err: unknown) {
		trx.rollback()
		if (err instanceof Error && err.message === `Already exists in infractions`) return;
		throw err // bubble up

	} finally {
		delete _writeLock[owner] // release write-lock
	}
}
