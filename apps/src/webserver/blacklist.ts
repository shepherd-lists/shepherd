import { Response } from 'express'
import { TxRecord, StateRecord, HistoryRecord } from '../common/types'
import getDb from '../common/utils/db-connection'
import { logger } from '../common/utils/logger'

const knex = getDb()

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

	const records = await knex<TxRecord>('txs').where({flagged: black})
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

	const records = await knex<TxRecord>('txs').where({flagged: black}).orderBy('id', 'desc')
	logger('flagged txs retrieved', records.length)
	html += '<h1>Number of records: ' + records.length + '</h1><table>\n'
	for (const record of records) {
		html += `<tr><td><a href="https://arweave.net/${record.txid}">${record.txid}</a></td><td>${record.content_size}</td><td>${record.content_type}</td></tr>\n`
	}

	return html + '</table></body></html>'
}

export const getStatsTestOnly = async(res: Response)=> {
	res.write('<html><body style="font-family:\'Courier New\',monospace;">')

	const txsCount = await knex<TxRecord>('txs').count('id')
	res.write(`<h1>Total records: ${txsCount[0].count}</h1>`)

	const scanPosn = await knex<StateRecord>('states').where({ pname: 'scanner_position'})
	res.write(`Scanner Position: ${scanPosn[0].value}`)

	const inflightNoop = await knex<TxRecord>('inflights').count('id')
	res.write(`<h2>Inflight noop: ${inflightNoop[0].count}</h2>`)

	const unfinished = await knex<TxRecord>('txs').whereNull('flagged').count('id')
	res.write(`<h2>Flagged: ${Number(txsCount[0].count) - Number(unfinished[0].count)}</h2>`)
	res.write(`<h2>Unflagged: ${unfinished[0].count}</h2>`)

	//select content_type, count(*) from txs where valid_data is null group by content_type;
	const results = await knex<TxRecord>('txs').select('content_type').count('content_type').whereNull('valid_data').groupBy('content_type')

	res.write('<table>')
	for (const result of results) {
		res.write(`<tr><td>${result.content_type}</td><td>${result.count}</td><tr>`)
	}
	res.write('</table>')
	
	res.write('</body></html>')
}

export const getPerfHistory = async()=> {
	let html = `<html>
		<style>
			table, th, td {
				border: 1px solid black;
				border-collapse: collapse;
			}
		</style>
		<body style="font-family:\'Courier New\',monospace;">`
	html += '<table>'

	const records = await knex<HistoryRecord>('history').select('*')//.orderBy('id', 'desc')

	//column names
	html += '<tr>'
	for(const key in records[0]){
		html += `<th><center>${key}</center></th>`
	}
	html += `<th><center>num processed</center></th>`
	html += '</tr>'

	const numFlagged = new Array(records.length)
	numFlagged[0] = 0

	//first entry
	html += '<tr>'
	for(const key in records[0]){
		//@ts-ignore
		html += `<td>${records[0][key]}</td>`
	}
	html += `<td>${numFlagged[0]}</td>`
	html += '</tr>'

	for (let i = 1; i < records.length; i++) {
		const recA = records[i - 1]
		const recB = records[i]
		numFlagged[i] = +recA.unflagged - +recB.unflagged + +recB.total_txs - +recA.total_txs
		html += '<tr>'
		for(const key in records[i]){
			//@ts-ignore
			html += `<td>${records[i][key]}</td>`
		}
		html += `<td>${numFlagged[i]}</td>`
		html += '</tr>'
	}

	html += '</table>'
	return html + '</body></html>'
}