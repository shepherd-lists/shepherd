import { TxRecord } from 'shepherd-plugin-interfaces/types'
import dbConnection from '../../../libs/utils/knexCreate'
import { moveInboxToTxs } from './move-records'

const knex = dbConnection()


let _running = false
const inbox2txs = async () => {
	if (_running) {
		console.info(inbox2txs.name, 'already running')
		return
	}
	_running = true
	const finished = await knex<TxRecord>('inbox')
		.select('txid')
		.whereNotNull('flagged')
	// .whereNotNull('valid_data')

	console.info(inbox2txs.name, `found ${finished.length} records in inbox.`)

	if (finished.length > 0) {
		const inserted = await moveInboxToTxs(finished.map(r => r.txid))

		console.info(inbox2txs.name, `inserted ${inserted}/${finished.length} records to txs.`)
	} else
		console.info(inbox2txs.name, 'no records to insert.')

	_running = false
}


setInterval(inbox2txs, 30_000)
inbox2txs()
