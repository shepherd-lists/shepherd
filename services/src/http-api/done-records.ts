import { StateRecord, TxRecord } from "../common/shepherd-plugin-interfaces/types"
import dbConnection from "../common/utils/db-connection"
import { moveInboxToTxs } from "./move-records"
import memoize from 'micro-memoize'

const knex = dbConnection()

interface DoneItem {
	txid: string
	height: number
}
let done: DoneItem[] = []
let last = Date.now()

/** call this early */
export const doneInit = async()=>{
	const archived  = await knex('outbox').select('txid', 'height')
	
	//return for test
	return done = archived;
}

/** export for test */
export const pass2Height = memoize(
	async()=> (await knex<StateRecord>('state').where('pname', '=', 'indexer_pass2'))[0]?.value,
	{ maxAge: 30_000, isPromise: true, },
)

let moving = false
export const doneAdd = async(txid: string, height: number)=>{
	done.push({ txid, height })
	await knex('outbox').insert({ txid, height })
	
	if(!moving){
		const now = Date.now()
		if(done.length >= 100 || now - last > 60_000){
			moving = true		
			await moveDone()
			last = now
			moving = false
		}
	}

	return done.length
}

/** export for test */
export const moveDone = async()=>{
	const pass2height = await pass2Height()
	const movable = done.filter(r=>r.height < pass2height)
	let count = 0
	while(movable.length > 0){
		const moving = movable.splice(0, Math.min(100, movable.length)).map(r=>r.txid)
		count += await moveInboxToTxs( moving )
		done = done.filter(r=>!moving.includes(r.txid))
	}
	return count;
}

