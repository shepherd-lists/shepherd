import { Response } from 'express'
import { TxRecord, StateRecord, HistoryRecord } from '../common/shepherd-plugin-interfaces/types'
import getDb from '../common/utils/db-connection'
import memoize from 'moize'

const knex = getDb()

const unfinishedMemoized = memoize(
	async()=> await knex<TxRecord>('txs').count('*').whereNull('flagged') as unknown as [{count: number | string}],
	{ 
		isPromise: true, 
		maxSize: 1, 
		maxAge: 5 * 60_000 
	},
)

export const getDevStats = async(res: Response)=> {
	console.log(getDevStats.name, `starting /stats response`)
	res.write('<html><body style="font-family:\'Courier New\',monospace;">\n')

	// SELECT reltuples AS estimate FROM pg_class WHERE relname = 'table_name';
	const txsCount = await knex('pg_class').select(knex.raw(`reltuples as estimate`)).where({ relname: 'txs' })
	console.log(getDevStats.name, {txsCount} )
	res.write(`<h1>Total records (estimate): ${txsCount[0].estimate}</h1>\n`)
	
	const indexPosn1 = await knex<StateRecord>('states').where({ pname: 'indexer_pass1'})
	console.log(getDevStats.name, {indexPosn: indexPosn1} )
	res.write(`Indexer Pass 1 Position: ${indexPosn1[0].value}\n`)
	
	const indexPosn2 = await knex<StateRecord>('states').where({ pname: 'indexer_pass2'})
	console.log(getDevStats.name, {indexPosn2} )
	res.write(`Indexer Pass 2 Position: ${indexPosn2[0].value}\n`)

	const inflightNoop = await knex('pg_class').select(knex.raw(`reltuples as estimate`)).where({ relname: 'inflights' })
	console.log(getDevStats.name, {inflightNoop} )
	res.write(`<h2>Inflight noop (estimate): ${inflightNoop[0].estimate}</h2>\n`)

	// res.write(`<h2>N.B. number of flagged, unflagged appears to be too expensive. Skipping</h2>\n`)
	
	const [unfinished] = await unfinishedMemoized()
	const unfinishedCount = unfinished?.count || "0"
	console.log(getDevStats.name, {unfinishedCount})
	res.write(`<h2>Unflagged (cached for 5 mins): ${unfinishedCount}</h2>\n`)
	res.write(`<h2>Flagged (total estimate - cached): ${+txsCount[0].estimate - +unfinishedCount}</h2>\n`)

	res.write(`N.B. aggregated counts by content-type appear to be too expensive. Skipping until fixed\n`)
	// //select content_type, count(*) from txs where valid_data is null group by content_type;
	// const results = await knex<TxRecord>('txs').select('content_type').count('content_type').whereNull('valid_data').groupBy('content_type')
	// console.log(`aggregated counts by content_type received`)

	// res.write('<table>')
	// for (const result of results) {
	// 	res.write(`<tr><td>${result.content_type}</td><td>${result.count}</td><tr>`)
	// }
	// res.write('</table>')
	
	res.write('</body></html>\n')
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