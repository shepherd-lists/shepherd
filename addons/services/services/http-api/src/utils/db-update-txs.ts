import { TxRecord } from 'shepherd-plugin-interfaces/types'
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

export const dbNoDataFound404 = async (txid: string) => {
	return updateTxsDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: '404',
		last_update_date: new Date(),
	})
}

export const dbNoDataFound = async (txid: string) => {
	return updateTxsDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: 'nodata',
		last_update_date: new Date(),
	})
}
export const dbNegligibleData = async (txid: string) => {
	return updateTxsDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: 'negligible-data',
		last_update_date: new Date(),
	})
}
export const dbMalformedXMLData = async (txid: string) => {
	return updateTxsDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: 'MalformedXML-data',
		last_update_date: new Date(),
	})
}

export const dbCorruptDataConfirmed = async (txid: string) => {
	return updateTxsDb(txid, {
		flagged: false,
		valid_data: false,
		data_reason: 'corrupt',
		last_update_date: new Date(),
	})
}

export const dbCorruptDataMaybe = async (txid: string) => {
	return updateTxsDb(txid, {
		// flagged: false, cannot flag
		valid_data: false,
		data_reason: 'corrupt-maybe',
		last_update_date: new Date(),
	})
}

export const dbPartialImageFound = async (txid: string) => {
	return updateTxsDb(txid, {
		// flagged: <= cannot flag 
		valid_data: false,
		data_reason: 'partial',
		last_update_date: new Date(),
	})
}

export const dbOversizedPngFound = async (txid: string) => {
	return updateTxsDb(txid, {
		// flagged: <= cannot flag yet! use tinypng, then rate again
		valid_data: false, // this removes it from current queue
		data_reason: 'oversized',
		last_update_date: new Date(),
	})
}


/** addon might not support. this is not an ideal ending point for a classifier pipeline. */
export const dbUnsupportedMimeType = async (txid: string) => {
	return updateTxsDb(txid, {
		// flagged: <= cannot flag
		valid_data: false,
		data_reason: 'unsupported',
		last_update_date: new Date(),
	})
}


export const checkTxFresh = async (txid: string) => {
	try {
		const fresh = await knex<TxRecord>('txs').where({ txid })
		return fresh.length === 0
	} catch (e) {
		const { name, message } = e as Error
		slackLog(txid, '❌ Error checking txs record', checkTxFresh.name, `${name}:${message}`, JSON.stringify(e))
	}
}

