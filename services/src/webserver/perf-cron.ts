import { GQL_URL } from '../common/constants'
import { HistoryRecord, StateRecord, TxRecord } from '../common/shepherd-plugin-interfaces/types'
import dbConnection from '../common/utils/db-connection'
import { gqlHeight } from '../common/utils/gql-height'

const knex = dbConnection()

const INTERVAL = 60*60*1000 //60 mins

let _running = false
const cronjob = async()=> {
	/** with very large backlog of records, a grouped flagged count query is taking 90+ minutes to complete.
	 * (total txs 90m, backlog in the 10s of millions.)
	 * replacing this with an estimate of total txs records, and index on `flagged is null`. the index will
	 * still be slow when there is a large backlog as postgres won't use the index, but this arrangement
	 * should still be relatively quicker.
	 */
	if(_running) return
	_running = true

	/** removing this offending query */
	// const results = await knex<TxRecord>('txs').select('flagged').count('*').groupBy('flagged')

	/* inaccurate, but hopefully good enough */
	const resTotalTxs = await knex('pg_class').select(knex.raw('reltuples as estimate')).where({ relname: 'txs' })
	const totalTxs: number = resTotalTxs[0].estimate

	/* costly query when `unflagged is null` count is high in backlog situations */
	const resUnflagged = await knex('txs').count('*').whereNull('flagged')
	const unflagged = resUnflagged[0]?.count || '0'

	const output: HistoryRecord = {
		total_txs: totalTxs.toString(),
		unflagged: unflagged.toString(),
		gql_height: await gqlHeight(GQL_URL),
		indexer_pass1: (await knex<StateRecord>('states').where({pname: 'indexer_pass1'}))[0].value
	}

	console.log('[perf-cron]', output)
	await knex<HistoryRecord>('history').insert(output)

	_running = false
}

setInterval(()=> {
	cronjob()
},INTERVAL)

cronjob() //run once at start also
