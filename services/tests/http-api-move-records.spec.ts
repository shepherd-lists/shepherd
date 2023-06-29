process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import { moveInboxToTxs } from '../src/http-api/move-records'
import knexCreate from '../src/common/utils/db-connection'
import { TxRecord } from '../src/common/shepherd-plugin-interfaces/types'

const knex = knexCreate()

describe('http-api move-records tests', ()=>{

	const mockRecord1: TxRecord = {
		txid: 'MOCK_RECORD1_456789012345678901234567890123',
		content_size: '100',
		content_type: 'test/dummy',
		height: 123,
		parent: 'mock_parent_3456789012345678901234567890123',
		flagged: false,
		valid_data: true,
		//@ts-ignore
		data_reason: null,
		last_update_date: new Date(),
	}
	const mockRecord2: TxRecord = {
		txid: 'MOCK_RECORD2_456789012345678901234567890123',
		content_size: '100',
		content_type: 'test/dummy',
		height: 123,
		parent: 'mock_parent_3456789012345678901234567890123',
		flagged: false,
		valid_data: true,
		//@ts-ignore
		data_reason: null,
		last_update_date: new Date(),
	}

	beforeEach(async function () {
		await knex('inbox_txs').insert([mockRecord1, mockRecord2])
	})
	afterEach(async function () {
		await knex('inbox_txs').delete()
		await knex('txs').delete()
	})

	it(`should move test records from inbox_txs to txs`, async()=>{

		const moved = await moveInboxToTxs([mockRecord1.txid, mockRecord2.txid])

		expect(moved, 'should return number of records moved').eq(2)

		const afterTxs = await knex('txs').whereIn('txid', [mockRecord1.txid, mockRecord2.txid])
		expect(afterTxs.length, 'records should exist in "txs" after running test').eq(2)

		const afterInbox = await knex('inbox_txs').whereIn('txid', [mockRecord1.txid, mockRecord2.txid])
		expect(afterInbox.length, 'records should not exist in "inbox_txs" after running test').eq(0)
	})

})
