import { TxRecord } from '../common/shepherd-plugin-interfaces/types'
import getDb from '../common/utils/db-connection'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { byteRangesUpdateDb } from '../byte-ranges/byteRanges'
import { Writable } from 'stream'
import { slackLogger } from '../common/utils/slackLogger'

const knex = getDb()

//serve cache for 3 mins
const CACHE_TIMEOUT = 3 * 60 * 1000 

let _cached =  {
	last: 0,
	txids: '',
	ranges: '',
	inProgress: false,
}
const getRecords = async(res: Writable, type: 'txids'|'ranges')=> {
	
	/** check if we are returning cache or not */
	const now = new Date().valueOf()
	if(_cached.inProgress || now - _cached.last < CACHE_TIMEOUT){
		const text = type == 'txids' ? _cached.txids : _cached.ranges
		logger(getRecords.name, `serving cache, ${text.length} bytes. inProgress: ${_cached.inProgress}`)
		return res.write(text);
	}
	_cached.inProgress = true
	_cached.last = now

	/** get records from db, stream straight out to respones, and cache for both lists */

	const records = knex<TxRecord>('txs').where({flagged: true}).stream()
	let txids = ''
	let ranges = ''
	let promises = []
	let count = 0
	for await (const record of records) {
		/* txid part is simple */
		const lineTxid = record.txid + '\n'
		txids += lineTxid

		/* ranges needs to be checked for '-1' or null */
		let lineRange;
		if(record.byteStart && record.byteStart !== '-1'){
			lineRange = `${record.byteStart},${record.byteEnd}\n`
			ranges += lineRange
		}
		if(!record.byteStart){
			/** null ranges must get populated (FYI, this code should no longer have to run) */
			logger(getRecords.name, `no byte-range found, calculating new range for '${record.txid}'...`)
			slackLogger(getRecords.name, `no byte-range found, calculating new range for '${record.txid}'...`)
			
			promises.push((async(txid, parent, parents)=>{
				const {start, end} = await byteRangesUpdateDb(txid, parent, parents) //db updated internally
				if(start !== -1n){
					const line = `${start},${end}\n`
					lineRange += line
					res.write(line) //we'll just write these out of sequence
				}
			}) (record.txid, record.parent, record.parents) )

			// batch them if there is a heavy backlog for some reason (this should not happen anymore)
			if(promises.length >= 100){
				await Promise.all(promises)
				promises = []
			}
		}

		/** write out available line */

		const line = type == 'txids' ? lineTxid : lineRange
		if(line){
			res.write(line)
		}
		if(++count % 10000 === 0) logger(getRecords.name, count, `records retrieved...`)
	}
	await Promise.all(promises)
	logger(getRecords.name, 'TxRecords retrieved', count)

	_cached.txids = txids
	_cached.ranges = ranges
	_cached.inProgress = false
}

export const getBlacklist = async(res: Writable)=> {
	return getRecords(res, 'txids')
}

export const getRangelist = async(res: Writable)=> {
	return getRecords(res, 'ranges')
}



