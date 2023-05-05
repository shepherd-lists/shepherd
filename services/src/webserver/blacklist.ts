import { TxRecord } from '../common/shepherd-plugin-interfaces/types'
import getDb from '../common/utils/db-connection'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { byteRanges } from '../byte-ranges/byteRanges'
import { Writable } from 'stream'

const knex = getDb()

//serve cache for 3 mins
const CACHE_TIMEOUT = 3 * 60 * 1000 

let _black =  {
	last: 0,
	text: '',
	inProgress: false,
}
export const getBlacklist = async(res: Writable)=> {

	const now = new Date().valueOf()

	if(_black.inProgress || now - _black.last < CACHE_TIMEOUT){
		logger('blacklist', `serving cache, ${_black.text.length} bytes. inProgress: ${_black.inProgress}`)
		return res.write(_black.text);
	}
	_black.inProgress = true
	_black.last = now

	const records = knex<TxRecord>('txs').where({flagged: true}).stream()
	let text = ''
	let count = 0
	for await (const record of records) {
		const line = record.txid + '\n'
		text += line
		res.write(line)
		if(++count % 10000 === 0) logger('blacklist', count, `records retrieved...`)
	}
	logger('blacklist', 'tx records retrieved', count)

	_black.text = text
	_black.inProgress = false
}

const _range = {
	last: 0,
	text: '',
	inProgress: false,
}
export const getRangelist = async(res: Writable)=> {

	const now = new Date().valueOf()
	
	if(_range.inProgress || now - _range.last < CACHE_TIMEOUT){
		logger('rangelist', `serving cache, ${_range.text.length} bytes. inProgress: ${_range.inProgress}`)
		return res.write(_range.text);
	}
	_range.inProgress = true
	_range.last = now

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
			logger(getRangelist.name, `calculating new byte-range for '${record.txid}'...`)
			
			promises.push((async(txid, parent, parents)=>{
				const {start, end} = await byteRanges(txid, parent, parents) //db updated internally
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

	logger('rangelist', 'tx records retrieved', count)
	_range.text = text
	_range.inProgress = false
}



