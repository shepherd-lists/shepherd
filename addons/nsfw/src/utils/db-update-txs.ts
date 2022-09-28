import { InflightsRecord, TxRecord } from 'shepherd-plugin-interfaces/types'
import getDbConnection from './db-connection'
import { logger } from './logger'


const knex = getDbConnection()


export const updateTxsDb = async(txid: string, updates: Partial<TxRecord>)=> {
	try{
		const checkId = await knex<TxRecord>('txs').where({txid}).update(updates, 'txid')
		if(checkId[0].txid !== txid){
			logger(txid, 'ERROR UPDATING DATABASE!', JSON.stringify(updates))
		}
		return checkId[0].txid;

	}catch(e:any){
		logger(txid, 'ERROR UPDATING DATABASE!', e.name, ':', e.message)
		logger(txid, e) // `throw e` does nothing, use the return
	}
}

export const dbInflightDel = async(txid: string)=> {
	try{
		const ret = await knex<InflightsRecord>('inflights').where({ txid, }).del('txid')
		if(ret[0].txid !== txid){
			logger(txid, 'DB_ERROR DELETING FROM INFLIGHTS', ret)
		}
		return ret[0].txid;
	}catch(e:any){
		logger(txid, 'DB_ERROR DELETING FROM INFLIGHTS', e.name, ':', e.message)
		logger(txid, e) // `throw e` does nothing, use the return
	}
}

export const dbInflightAdd = async(txid: string)=> {
	try{
		//knex just not up to the task in this case :-(

		const ret = await knex.raw(`INSERT INTO inflights (txid, foreign_id)
			SELECT '${txid}', id AS foreign_id FROM txs WHERE txid='${txid}'
			RETURNING txid;`
		)
		//consider adding ON CONFLICT DO NOTHING ?

		if(ret.rows[0].txid !== txid){
			logger(txid, 'DB_ERROR ADDING TO INFLIGHTS', ret)
		}
		return ret.rows[0].txid;
	}catch(e:any){
		logger(txid, 'DB_ERROR ADDING TO INFLIGHTS', e.name, ':', e.message)
		logger(txid, e) // `throw e` does nothing, use the return
	}	
}


export const dbNoDataFound404 = async(txid: string)=> {
	await dbInflightDel(txid)
	return updateTxsDb(txid,{
		flagged: false,
		valid_data: false,
		data_reason: '404',
		last_update_date: new Date(),
	})
}

export const dbNoDataFound = async(txid: string)=> {
	await dbInflightDel(txid)
	return updateTxsDb(txid,{
		flagged: false,
		valid_data: false,
		data_reason: 'nodata',
		last_update_date: new Date(),
	})
}
export const dbNegligibleData = async(txid: string)=> {
	await dbInflightDel(txid)
	return updateTxsDb(txid,{
		flagged: false,
		valid_data: false,
		data_reason: 'negligible-data',
		last_update_date: new Date(),
	})
}
export const dbMalformedXMLData = async(txid: string)=> {
	await dbInflightDel(txid)
	return updateTxsDb(txid,{
		flagged: false,
		valid_data: false,
		data_reason: 'MalformedXML-data',
		last_update_date: new Date(),
	})
}

export const dbCorruptDataConfirmed = async(txid: string)=> {
	return updateTxsDb(txid,{
		flagged: false,
		valid_data: false,
		data_reason: 'corrupt',
		last_update_date: new Date(),
	})
}

export const dbCorruptDataMaybe = async(txid: string)=> {
	return updateTxsDb(txid,{
		// flagged: false, <= try filetype detection first
		valid_data: false,
		data_reason: 'corrupt-maybe',
		last_update_date: new Date(),
	})
}

export const dbPartialImageFound = async(txid: string)=> {
	return updateTxsDb(txid,{
		// flagged: <= cannot flag yet! display with puppeteer & rate again
		valid_data: false, // this removes it from current queue
		data_reason: 'partial',
		last_update_date: new Date(),
	})
}

export const dbPartialVideoFound = async(txid: string)=> {
	return updateTxsDb(txid,{
		// flagged: undefined,  // this gets set in the normal way in another call
		// valid_data: undefined,
		data_reason: 'partial-seed', //check later if fully seeded
		last_update_date: new Date(),
	})
}

export const dbOversizedPngFound = async(txid: string)=> {
	return updateTxsDb(txid,{
		// flagged: <= cannot flag yet! use tinypng, then rate again
		valid_data: false, // this removes it from current queue
		data_reason: 'oversized',
		last_update_date: new Date(),
	})
}

export const dbTimeoutInBatch = async(txid: string)=> {
	return updateTxsDb(txid,{
		// flagged: <= need recheck: may be due to other delay during timeout or data not seeded yet
		valid_data: false,
		data_reason: 'timeout',
		last_update_date: new Date(),
	})
}

export const dbWrongMimeType = async(txid: string, content_type: string)=> {
	return updateTxsDb(txid,{
		// this will be retried in the relevant queue
		content_type,
		data_reason: 'mimetype',
		last_update_date: new Date(),
	})
}

export const dbNoMimeType = async(txid: string)=> {
	return updateTxsDb(txid,{
		flagged: false,
		content_type: 'undefined',
		data_reason: 'mimetype',
		last_update_date: new Date(),
	})
}

export const dbUnsupportedMimeType = async(txid: string)=> {
	return updateTxsDb(txid,{
		// flagged: <= cannot flag yet! display with puppeteer & rate again
		valid_data: false, // this removes it from current queue
		data_reason: 'unsupported',
		last_update_date: new Date(),
	})
}
