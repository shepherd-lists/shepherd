import { TxRecord } from '../common/shepherd-plugin-interfaces/types'
import getDb from '../common/utils/db-connection'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { byteRanges } from './byteRanges'
import { Writable } from 'stream'

const knex = getDb()

//serve cache for 3 mins
const timeout = 3 * 60 * 1000 // min 5 mins between list updates

let _black =  {
	last: 0,
	text: '',
}
export const getBlacklist = async(res: Writable)=> {

	const now = new Date().valueOf()
	
	if(now - _black.last > timeout) _black.last = now
	else{ 
		logger('blacklist', 'serving cache')
		return res.write(_black.text);
	}

	const records = await knex<TxRecord>('txs').where({flagged: true})
	logger('blacklist', 'tx records retrieved', records.length)
	let text = ''
	for (const record of records) {
		const line = record.txid + '\n'
		text += line
		res.write(line)
	}

	_black.text = text
}

const _range = {
	last: 0,
	text: '',
}
export const getRangelist = async(res: Writable)=> {

	const now = new Date().valueOf()
	
	if(now - _range.last > timeout) _range.last = now
	else{ 
		logger('rangelist', 'serving cache')
		return res.write(_range.text);
	}

	const records = await knex<TxRecord>('txs').where({flagged: true})
	logger('rangelist', 'tx records retrieved', records.length)
	let text = ''
	let promises = []

	for (const record of records) {
		if(record.byteStart && record.byteStart !== '-1'){ // (-1,-1) denotes an error. e.g. weave data unavailable
			const line = `${record.byteStart},${record.byteEnd}\n`
			text += line
			res.write(line)
		}else{
			logger(getRangelist.name, `calculating new byte-range for '${record.txid}'...`)
			
			promises.push((async(txid, parent)=>{
				const {start, end} = await byteRanges(txid, parent) //db updated internally
				if(start !== -1n){
					const line = `${start},${end}\n`
					text += line
					res.write(line)
				}
			}) (record.txid, record.parent) )

			// batch them a bit
			if(promises.length >= 100){
				await Promise.all(promises)
				promises = []
			}
		}
	}
	await Promise.all(promises) //all errors are handled internally

	_range.text = text
}



