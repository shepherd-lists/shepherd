import { InflightsRecord, TxRecord } from 'shepherd-plugin-interfaces/types'
import getDbConnection from '../../../../libs/utils/knexCreate'
import { slackLog } from '../../../../libs/utils/slackLog'


const knex = getDbConnection()


/** master update 'txs' function */
export const updateTxsDb = async (txid: string, updates: Partial<TxRecord>, tablename: string = 'txs') => {
	try {
		const checkId = await knex<TxRecord>(tablename).where({ txid }).update(updates, 'txid').returning('txid')
		const retTxid = checkId[0]?.txid
		if (retTxid !== txid) {
			slackLog(txid, `ERROR UPDATING ${tablename} DATABASE!`, `(${JSON.stringify(updates)}) => ${checkId}`)
		}
		return retTxid

	} catch (err: unknown) {
		const e = err as Error
		slackLog(txid, `ERROR UPDATING ${tablename} DATABASE!`, e.name, ':', e.message, JSON.stringify(updates))
		// `throw e` does nothing, use the return
	}
}
/** master update 'inbox' function */
export const updateInboxDb = async (txid: string, updates: Partial<TxRecord>) => {
	try {
		const checkId = await knex<TxRecord>('inbox').where({ txid }).update(updates).returning(['txid', 'height'])
		const retTxid = checkId[0]?.txid
		if (retTxid !== txid) {
			const existingTxs = await knex<TxRecord>('txs').where({ txid })
			if (existingTxs.length === 1) {
				const checkId2 = await knex<TxRecord>('txs').where({ txid }).update(updates).returning('txid')
				console.warn(txid, 'Info: Could not update inbox, but txs table was updated', `(${JSON.stringify(updates)}) => checkId:${JSON.stringify(checkId)} checkId2:${JSON.stringify(checkId2)}`)
				// slackLogger(txid, `Info: Could not update inbox, but txs table was updated`, `(${JSON.stringify(updates)}) => checkId:${JSON.stringify(checkId)} checkId2:${JSON.stringify(checkId2)}`)
				/* clean up `inbox` just in case there was some other problem */
				await knex<TxRecord>('inbox').where({ txid }).del('txid')
				return checkId2[0]?.txid
			} else {
				slackLog(txid, 'ERROR UPDATING inbox DATABASE!', `(${JSON.stringify(updates)}) => "${checkId}"`)
			}
		}
		return retTxid

	} catch (err: unknown) {
		const e = err as Error
		slackLog(txid, 'ERROR UPDATING inbox DATABASE!', e.name, ':', e.message, JSON.stringify(updates))
		console.error(txid, e) // `throw e` does nothing, use the return
	}
}

export const dbInflightDel = async (txid: string) => {
	try {
		const ret = await knex<InflightsRecord>('inflights').where({ txid, }).del('txid')
		if (ret[0]?.txid !== txid) {
			console.error(txid, 'record not found while deleting from inflights')
			return
		}
		return ret[0].txid
	} catch (err: unknown) {
		const e = err as Error
		console.error(txid, 'DB_ERROR DELETING FROM INFLIGHTS', e.name, ':', e.message)
		console.error(txid, e) // `throw e` does nothing, use the return
	}
}

export const dbInflightAdd = async (txid: string) => {
	try {
		const ret = await knex<InflightsRecord>('inflights').insert({ txid }, 'txid')

		if (ret[0].txid !== txid) {
			console.error(txid, 'DB_ERROR ADDING TO INFLIGHTS', ret)
		}
		return ret[0].txid
	} catch (err: unknown) {
		const e = err as Error
		slackLog(txid, 'DB_ERROR ADDING TO INFLIGHTS', e.name, ':', e.message)
		console.error(txid, e) // `throw e` does nothing, use the return
	}
}


export const dbNoDataFound404 = async (txid: string) => {
	return updateInboxDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: '404',
		last_update_date: new Date(),
	})
}

export const dbNoDataFound = async (txid: string) => {
	return updateInboxDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: 'nodata',
		last_update_date: new Date(),
	})
}
export const dbNegligibleData = async (txid: string) => {
	return updateInboxDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: 'negligible-data',
		last_update_date: new Date(),
	})
}
export const dbMalformedXMLData = async (txid: string) => {
	return updateInboxDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: 'MalformedXML-data',
		last_update_date: new Date(),
	})
}

export const dbCorruptDataConfirmed = async (txid: string) => {
	return updateInboxDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: 'corrupt',
		last_update_date: new Date(),
	})
}

export const dbCorruptDataMaybe = async (txid: string) => {
	return updateInboxDb(txid, {
		// flagged: false, <= try filetype detection first
		valid_data: false,
		data_reason: 'corrupt-maybe',
		last_update_date: new Date(),
	})
}

export const dbPartialImageFound = async (txid: string) => {
	return updateInboxDb(txid, {
		// flagged: <= cannot flag yet! display with puppeteer & rate again
		valid_data: false, // this removes it from current queue
		data_reason: 'partial',
		last_update_date: new Date(),
	})
}

export const dbPartialVideoFound = async (txid: string) => {
	slackLog(txid, 'info: `partial-seed` video found, gets retried until done?') //check if these actually happen
	return updateInboxDb(txid, {
		// flagged: undefined,  // this gets set in the normal way in another call
		// valid_data: undefined,
		data_reason: 'partial-seed', //check later if fully seeded. these never occurred?
		last_update_date: new Date(),
	})
}

export const dbOversizedPngFound = async (txid: string) => {
	return updateInboxDb(txid, {
		// flagged: <= cannot flag yet! use tinypng, then rate again
		valid_data: false, // this removes it from current queue
		data_reason: 'oversized',
		last_update_date: new Date(),
	})
}

export const dbWrongMimeType = async (txid: string, content_type: string) => {
	const nonMedia = !content_type.startsWith('image') && !content_type.startsWith('video')
	const updatedId = await updateInboxDb(txid, {
		// this will be retried in the relevant queue or:
		...(nonMedia && {
			flagged: false,
			valid_data: false,
		}),
		content_type,
		data_reason: 'mimetype',
		last_update_date: new Date(),
	})
	/** retry under correct conditions */
	if (!nonMedia && updatedId) {
		await dbInflightDel(txid)
	}
	return updatedId
}

export const dbUnsupportedMimeType = async (txid: string) => {
	return updateInboxDb(txid, {
		// flagged: <= cannot flag yet! display with puppeteer & rate again
		valid_data: false, // this removes it from current queue
		data_reason: 'unsupported',
		last_update_date: new Date(),
	})
}

/** retrieve a single TxRecord by txid */
export const getTxFromInbox = async (txid: string) => {
	try {
		const ret = await knex<TxRecord>('inbox').where({ txid })
		if (ret.length === 0) {
			const res = (await knex('txs').where({ txid }))

			if (res.length > 0) {
				console.info(txid, 'Not found in inbox, already moved to txs table.')
				// slackLogger(txid, 'Not found in inbox, already moved to txs table.')
				return
			} else {
				throw new Error('Not found in inbox. Not moved to txs table.')
			}
		}
		return ret[0]
	} catch (err: unknown) {
		const e = err as Error
		slackLog(txid, '❌ Error getting inbox tx record', e.name, ':', e.message, JSON.stringify(e))
		throw e
	}
}

export const checkTxFresh = async (txid: string) => {
	try {
		const fresh = await knex<TxRecord>('txs').where({ txid })
		return fresh.length === 0
	} catch (e) {
		const { name, message } = e as Error
		slackLog(txid, '❌ Error checking txs record', `${name}:${message}`, JSON.stringify(e))
	}
}

