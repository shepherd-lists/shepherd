import { TxRecord, StateRecord, HistoryRecord } from '../types'
import getDb from '../utils/db-connection'
import { logger } from '../utils/logger'

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

export const getStatsTestOnly = async()=> {
	let html = '<html><body style="font-family:\'Courier New\',monospace;">'

	const txsCount = await knex<TxRecord>('txs').count('id')
	html += `<h1>Total records: ${txsCount[0].count}</h1>`

	const scanPosn = await knex<StateRecord>('states').where({ pname: 'scanner_position'})
	html += `Scanner Position: ${scanPosn[0].value}` 

	const inflightNoop = await knex<TxRecord>('txs').whereNull('flagged').where({data_reason: 'noop'}).count('id')
	html += `<h2>Inflight noop: ${inflightNoop[0].count}</h2>`

	const unfinished = await knex<TxRecord>('txs').whereNull('flagged').count('id')
	html += `<h2>Flagged: ${Number(txsCount[0].count) - Number(unfinished[0].count)}</h2>`
	html += `<h2>Unflagged: ${unfinished[0].count}</h2>`

	//select content_type, count(*) from txs where valid_data is null group by content_type;
	const results = await knex<TxRecord>('txs').select('content_type').count('content_type').whereNull('valid_data').groupBy('content_type')

	html += '<table>'
	for (const res of results) {
		html += `<tr><td>${res.content_type}</td><td>${res.count}</td><tr>`
	}
	html += '</table>'
	
	return html + '</body></html>'
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

	const records = await knex<HistoryRecord>('history').select('*').orderBy('id', 'desc')

	//column names
	html += '<tr>'
	for(const key in records[0]){
		html += `<th><center>${key}</center></th>`
	}
	html += '</tr>'

	for(const record of records) {
		console.log(record)
		html += '<tr>'
		for(const key in record){
			//@ts-ignore
			html += `<td>${record[key]}</td>`
		}
		html += '</tr>'
	}
	
	html += '</table>'
	return html + '</body></html>'
}