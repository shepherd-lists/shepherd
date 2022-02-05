import { TxRecord } from '../types'
import getDb from '../utils/db-connection'
import { logger } from '../utils/logger'

const db = getDb()

//serve cache for 5 mins
const timeout = 5 * 60 * 1000 // min 5 mins between list updates
let _lastBlack = 0
let _lastWhite = 0
let _whiteText = ''
let _blackText = ''

export const getBlacklist = async(black: boolean)=> {

	const now = new Date().valueOf()
	if(black){
		if(now - _lastBlack > timeout) _lastBlack = now
		else{ 
			logger('serving cached blacklist')
			return _blackText	
		}
	} else{
		if(now - _lastWhite > timeout) _lastWhite = now
		else{ 
			logger('serving cached whitelist')
			return _whiteText 
		}
	}

	const records = await db<TxRecord>('txs').where({flagged: black})
	logger('flagged txs retrieved', records.length)
	let text = ''
	for (const record of records) {
		text += record.txid + '\n'
	}

	if(black) _blackText = text
	else _whiteText = text
	
	return text
}

export const getBlacklistTestOnly = async(black: boolean)=> {
	let html = '<html><body style="font-family:\'Courier New\',monospace;">'

	const records = await db<TxRecord>('txs').where({flagged: black}).orderBy('id', 'desc')
	logger('flagged txs retrieved', records.length)
	html += '<h1>Number of records: ' + records.length + '</h1><table>\n'
	for (const record of records) {
		html += `<tr><td><a href="https://arweave.net/${record.txid}">${record.txid}</a></td><td>${record.content_size}</td><td>${record.content_type}</td><td>porn=${record.nsfw_porn}</td><td>sexy=${record.nsfw_sexy}</td><td>hentai=${record.nsfw_hentai}</td><td>drawings=${record.nsfw_drawings}</td><td>neutral=${record.nsfw_neutral}</td></tr>\n`
	}

	return html + '</table></body></html>'
}

export const getStatsTestOnly = async()=> {
	let html = '<html><body style="font-family:\'Courier New\',monospace;">'

	const txsCount = await db<TxRecord>('txs').count('id')
	html += `<h1>Total records: ${txsCount[0].count}</h1>`

	const inflightNoop = await db<TxRecord>('txs').whereNull('flagged').where({data_reason: 'noop'}).count('id')
	html += `<h2>Inflight noop: ${inflightNoop[0].count}</h2>`

	const unfinished = await db<TxRecord>('txs').whereNull('flagged').count('id')
	html += `<h2>Unflagged: ${unfinished[0].count}</h2>`

	//select content_type, count(*) from txs where valid_data is null group by content_type;
	const results = await db<TxRecord>('txs').select('content_type').count('content_type').whereNull('valid_data').groupBy('content_type')

	html += '<table>'
	for (const res of results) {
		html += `<tr><td>${res.content_type}</td><td>${res.count}</td><tr>`
	}
	html += '</table>'
	

	
	return html + '</table></body></html>'
}
