import { HistoryRecord, StateRecord, TxRecord } from "../types";
import dbConnection from "../utils/db-connection";
import { getGqlHeight } from "../utils/gql-height";

const knex = dbConnection()

const INTERVAL = 60*60*1000 //1 hr

setInterval(()=> {
	cronjob();
},INTERVAL)

const cronjob = async()=> {
	// count group by flagged
	const results = await knex<TxRecord>('txs').select('flagged').count('*').groupBy('flagged')

	const output: Partial<HistoryRecord> = {}
	let totalTxs = 0
	for (const result of results) {
		//@ts-ignore
		const count: string = result.count
		if(result.flagged === null){
			output.unflagged = count
		}
		totalTxs += +count
	}

	output.total_txs = totalTxs.toString()
	output.gql_height = await getGqlHeight()
	output.scanner_position = (await knex<StateRecord>('states').where({pname: 'scanner_position'}))[0].value

	console.log('[perf-cron]', output)
	await knex<HistoryRecord>('history').insert(output)
}