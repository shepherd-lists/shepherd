import { Response } from 'express'
import { TxRecord, StateRecord, HistoryRecord } from '../common/shepherd-plugin-interfaces/types'
import getDb from '../common/utils/db-connection'
const knex = getDb()

export const getStatsTestOnly = async(res: Response)=> {
	res.write('<html><body style="font-family:\'Courier New\',monospace;">')

	const txsCount = await knex<TxRecord>('txs').count('id')
	res.write(`<h1>Total records: ${txsCount[0].count}</h1>`)

	const indexPosn = await knex<StateRecord>('states').where({ pname: 'scanner_position'})
	res.write(`Indexer Position: ${indexPosn[0].value}`)

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

export const getPerfHistory = async(res: Response)=> {
	res.write(
		`<html>
		<style>
			table, th, td {
				border: 1px solid black;
				border-collapse: collapse;
			}
		</style>
		<body style="font-family:\'Courier New\',monospace;">
			<table>`
	)

	const records = await knex<HistoryRecord>('history').select('*')//.orderBy('id', 'desc')

	//column names
	res.write('<tr>')
	for(const key in records[0]){
		res.write(`<th><center>${key}</center></th>`)
	}
	res.write(`<th><center>num processed</center></th>`)
	res.write('</tr>')

	const numFlagged = new Array(records.length)
	numFlagged[0] = 0

	//first entry
	res.write('<tr>')
	for(const key in records[0]){
		//@ts-ignore
		res.write(`<td>${records[0][key]}</td>`)
	}
	res.write(`<td>${numFlagged[0]}</td>`)
	res.write('</tr>')

	for (let i = 1; i < records.length; i++) {
		const recA = records[i - 1]
		const recB = records[i]
		numFlagged[i] = +recA.unflagged - +recB.unflagged + +recB.total_txs - +recA.total_txs
		res.write('<tr>')
		for(const key in records[i]){
			//@ts-ignore
			res.write(`<td>${records[i][key]}</td>`)
		}
		res.write(`<td>${numFlagged[i]}</td>`)
		res.write('</tr>')
	}

	res.write('</table>')
	res.write('</body></html>')
}