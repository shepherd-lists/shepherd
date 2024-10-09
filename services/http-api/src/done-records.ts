import { StateRecord, TxRecord } from 'shepherd-plugin-interfaces/types'
import dbConnection from '../../../libs/utils/knexCreate'
import { moveInboxToTxs } from './move-records'
import moize from 'moize'

const knex = dbConnection()


let _running = false
const inbox2txs = async () => {
	if (_running) {
		console.info(inbox2txs.name, 'already running')
		return
	}
	_running = true
	// const pass2height = await pass2Height()
	const finished = await knex<TxRecord>('inbox')
		.select('txid')
		// .whereNotNull('flagged')
		.whereNotNull('valid_data')

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

/** export for test */
// export const pass2Height = moize(
// 	async () => (await knex<StateRecord>('states').where('pname', '=', 'indexer_pass2'))[0]?.value,
// 	{ maxAge: 30_000, isPromise: true, },
// )

// export const doneAdd = async (txid: string, height: number) => {
// 	/** dont add dupes */
// 	if (done.map(r => r.txid).includes(txid)) {
// 		console.warn(txid, doneAdd.name, 'warning: not adding duplicate!')
// 		return done.length
// 	}

// 	console.info(txid, doneAdd.name, `adding to done. moving: ${moving}, done.length: ${done.length}`)
// 	done.push({ txid, height })

// 	const now = Date.now()
// 	const timeDiff = now - last
// 	if (done.length >= 100 || timeDiff > 30_000) {
// 		console.info(txid, doneAdd.name, `calling moveDone. done.length: ${done.length}, now - last: ${timeDiff}`)
// 		await moveDone()
// 		if (timeDiff > 30_000) last = now
// 	} else {
// 		console.info(txid, doneAdd.name, `not moving yet. done.length: ${done.length}, now - last: ${timeDiff}`)
// 	}

// 	return done.length
// }

// let moving = false
// export const moveDone = async () => {
// 	if (!moving) {
// 		moving = true

// 		// const movable = done.filter(r => r.height < pass2height)

// 		console.info(moveDone.name, `moving ${done.length} records to txs.`)
// 		let count = 0
// 		while (done.length > 0) {
// 			const moving = done.splice(0, Math.min(100, done.length)).map(r => r.txid)
// 			count += await moveInboxToTxs(moving)
// 			done = done.filter(r => !moving.includes(r.txid)) //??
// 		}

// 		moving = false
// 		return count
// 	} else {
// 		console.info(moveDone.name, 'already moving')
// 		return
// 	}
// }

