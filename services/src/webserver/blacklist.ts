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
	text: '',
	inProgress: false,
}
export const getBlacklist = async(res: Writable)=> {

	const now = new Date().valueOf()

	if(_cached.inProgress || now - _cached.last < CACHE_TIMEOUT){
		logger('blacklist', `serving cache, ${_cached.text.length} bytes. inProgress: ${_cached.inProgress}`)
		return res.write(_cached.text);
	}
	_cached.inProgress = true
	_cached.last = now

	const records = knex<TxRecord>('txs').where({flagged: true}).stream()
	let text = ''
	let count = 0
	for await (const record of records) {
		const line = record.txid + '\n'
		text += line
		res.write(line)
		if(++count % 10000 === 0) logger('blacklist', count, `records retrieved...`)
	}
	logger('blacklist', 'TxRecords retrieved', count)

	_cached.text = text
	_cached.inProgress = false
}

export const getRangelist = async(res: Writable)=> {

	const now = new Date().valueOf()
	
	if(_cached.inProgress || now - _cached.last < CACHE_TIMEOUT){
		logger('rangelist', `serving cache, ${_cached.text.length} bytes. inProgress: ${_cached.inProgress}`)
		return res.write(_cached.text);
	}
	_cached.inProgress = true
	_cached.last = now

	const records = knex<TxRecord>('txs').where({flagged: true}).stream()
	let text = ''
	let promises = []
	let count = 0

	for await (const record of records) {
		if(record.byteStart && record.byteStart !== '-1'){ // (-1,-1) denotes an error. e.g. weave data unavailable
			const line = `${record.byteStart},${record.byteEnd}\n`
			text += line
			res.write(line)
		}else if(!record.byteStart){
			logger(getRangelist.name, `no byte-range found, calculating new range for '${record.txid}'...`)
			slackLogger(getRangelist.name, `no byte-range found, calculating new range for '${record.txid}'...`)
			
			promises.push((async(txid, parent, parents)=>{
				const {start, end} = await byteRangesUpdateDb(txid, parent, parents) //db updated internally
				if(start !== -1n){
					const line = `${start},${end}\n`
					text += line
					res.write(line)
				}
			}) (record.txid, record.parent, record.parents) )

			// batch them a bit
			if(promises.length >= 100){
				await Promise.all(promises)
				promises = []
			}
		}
		if(++count % 10000 === 0) logger('rangelist', count, `records processed/retrieved...`)
	}
	await Promise.all(promises) //all errors are handled internally

	logger('rangelist', 'TxRecords retrieved', count)
	_cached.text = text
	_cached.inProgress = false
}



