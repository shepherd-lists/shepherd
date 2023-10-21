import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { StateRecord, TxRecord } from '../common/shepherd-plugin-interfaces/types'
import dbConnection from '../common/utils/db-connection'
import { moveInboxToTxs } from './move-records'
import moize from 'moize'

const knex = dbConnection()

interface DoneItem {
	txid: string
	height: number
}
let done: DoneItem[] = []
let last = Date.now()

/** call this early */
export const doneInit = async()=>{
	const pass2height = await pass2Height()
	const archived  = await knex<TxRecord>('inbox')
		.select('txid', 'height')
		.whereNotNull('flagged')

	logger(doneInit.name, `found ${archived.length} records in inbox. pass2.height: ${pass2height}`)

	//return for test
	return done = archived
}

/** export for test */
export const pass2Height = moize(
	async()=> (await knex<StateRecord>('states').where('pname', '=', 'indexer_pass2'))[0]?.value,
	{ maxAge: 30_000, isPromise: true, },
)

export const doneAdd = async(txid: string, height: number)=>{
	/** dont add dupes */
	if(done.map(r=>r.txid).includes(txid)){
		logger(txid, doneAdd.name, 'warning: not adding duplicate!')
		return done.length
	}

	logger(txid, doneAdd.name, `adding to done. moving: ${moving}, done.length: ${done.length}`)
	done.push({ txid, height })

	const now = Date.now()
	const timeDiff = now - last
	if(done.length >= 100 || timeDiff > 60_000){
		logger(txid, doneAdd.name, `calling moveDone. done.length: ${done.length}, now - last: ${timeDiff}`)
		await moveDone()
		if(timeDiff > 60_000) last = now
	}else{
		logger(txid, doneAdd.name, `not moving yet. done.length: ${done.length}, now - last: ${timeDiff}`)
	}

	return done.length
}

let moving = false
export const moveDone = async()=>{
	if(!moving){
		moving = true

		const pass2height = await pass2Height()
		const movable = done.filter(r=>r.height < pass2height)

		logger(moveDone.name, `moving movable ${movable.length}/${done.length} records to txs. pass2.height: ${pass2height}`)
		let count = 0
		while(movable.length > 0){
			const moving = movable.splice(0, Math.min(100, movable.length)).map(r=>r.txid)
			count += await moveInboxToTxs( moving )
			done = done.filter(r=>!moving.includes(r.txid))
		}

		moving = false
		return count
	}else{
		logger(moveDone.name, 'already moving')
		return
	}
}

