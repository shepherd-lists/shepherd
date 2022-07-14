process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import { TxRecord } from '../src/common/types'
import dbConnection from '../src/common/utils/db-connection'
import { updateTxsDb } from '../src/common/utils/db-update-txs'

const knex = dbConnection()

describe('updateTxsDb tests', ()=>{

	const fakeTxid = 'fake-txid-123456789012345678901234567890123'

	before(async function() {
		this.timeout(0)
		try{
			/* set up data for 404 test */
			const checkId = await knex<TxRecord>('txs').where({ txid: fakeTxid })
			if(checkId.length !== 1){
				await knex<TxRecord>('txs').insert({txid: fakeTxid, content_type: 'text/plain', content_size: '321'})
			}
		}catch(e:any){
			console.log('error connecting to DB', JSON.stringify(e))
			process.exit(1)
		}
	})

	after(async function() {
		this.timeout(0)
		await knex<TxRecord>('txs').delete().where({ txid: fakeTxid })
	})

	it('tests updateTxsDb return a txid to check against', async()=> {
		const res = await updateTxsDb(fakeTxid, { data_reason: 'noop' })
		expect(res).to.exist
		expect(res).eq(fakeTxid)
	})


})

