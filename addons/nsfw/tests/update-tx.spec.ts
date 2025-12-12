process.env['NODE_ENV'] = 'test'
import 'mocha'
import { expect } from 'chai'
import { sendOutputMsg } from '../src/utils/update-txs'
import knexConn from './utils/dbConnection-for-tests-only'
import { TxRecord } from 'shepherd-plugin-interfaces/types'



const knex = knexConn()

console.log(`process.env.HTTP_API_URL: ${process.env.HTTP_API_URL}`)

describe('update-tx', () => {

	it('should post a tx update to the http-api', async () => {
		const txid = 'test-txid-test-txid-test-txid-test-txid-123'

		await knex<TxRecord>('txs').insert({
			txid, height: 123, content_type: 'text/plain', content_size: '123',
		})

		const res = await sendOutputMsg(txid, {
			flagged: false,
		})
		expect(res).to.equal(txid)
	})


})
