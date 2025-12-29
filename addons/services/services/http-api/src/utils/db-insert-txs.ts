import { InflightsRecord, TxRecord } from 'shepherd-plugin-interfaces/types'
import getDbConnection from '../../../../libs/utils/knexCreate'
import { slackLog } from '../../../../libs/utils/slackLog'
import { mergeRulesObject } from '../service/move-records'


const knex = getDbConnection()


/** master insert 'txs' function */
export const insertTxsDb = async (txid: string, updates: TxRecord, tablename: string = 'txs') => {
	const checkId = await knex<TxRecord>(tablename)
		.insert(updates, 'txid')
		.onConflict('txid').merge(mergeRulesObject())
		.returning('txid')
	const retTxid = checkId[0]?.txid
	if (retTxid !== txid) {
		throw new Error(`${txid} ERROR UPDATING ${tablename} DATABASE! (${JSON.stringify(updates)}) => "${checkId}"`)
	}
	return retTxid
}


export const dbCorruptDataConfirmed = async (record: TxRecord) => {
	return insertTxsDb(record.txid, {
		...record,
		flagged: false,
		valid_data: false,
		data_reason: 'corrupt',
		last_update_date: new Date(),
	})
}

export const dbCorruptDataMaybe = async (record: TxRecord) => {
	return insertTxsDb(record.txid, {
		...record,
		//@ts-ignore flagged: null is valid
		flagged: null,
		valid_data: false,
		data_reason: 'corrupt-maybe',
		last_update_date: new Date(),
	})
}

export const dbPartialImageFound = async (record: TxRecord) => {
	return insertTxsDb(record.txid, {
		...record,
		//@ts-ignore flagged: null is valid
		flagged: null,
		valid_data: false,
		data_reason: 'partial',
		last_update_date: new Date(),
	})
}

export const dbOversizedPngFound = async (record: TxRecord) => {
	return insertTxsDb(record.txid, {
		...record,
		//@ts-ignore flagged: null is valid
		flagged: null,
		valid_data: false, // this removes it from current queue
		data_reason: 'oversized',
		last_update_date: new Date(),
	})
}


/** addon might not support. this is not an ideal ending point for a classifier pipeline. */
export const dbUnsupportedMimeType = async (record: TxRecord) => {
	return insertTxsDb(record.txid, {
		...record,
		//@ts-ignore flagged: null is valid
		flagged: null,
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

