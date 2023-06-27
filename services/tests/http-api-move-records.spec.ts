process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import { findMovableRecords, moveInboxToTxs } from '../src/http-api/move-records'
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

	it('should return completed records below a given height', async()=>{
		/** insert some other test records */
		const unfinished: TxRecord = {
			txid: 'UNFINISHED_23456789012345678901234567890123',
			content_size: '100',
			content_type: 'test/dummy',
			height: 1,
			parent: 'mock_parent2_456789012345678901234567890123',
			// flagged: undefined,
			// valid_data: undefined,
			// @ts-ignore
			data_reason: undefined,
			last_update_date: new Date(),
		}
		const finished1_000_000: TxRecord = {
			txid: 'FINISHED_0123456789012345678901234567890124',
			content_size: '100',
			content_type: 'test/dummy',
			height: 1000000,
			parent: 'mock_parent3_456789012345678901234567890123',
			flagged: true,
			valid_data: true,
			//@ts-ignore
			data_reason: null,
			last_update_date: new Date(),
		}
		await knex<TxRecord>('inbox_txs').insert([ unfinished, finished1_000_000 ])

		const maxHeight = 124

		const foundIds = ( await findMovableRecords(maxHeight) ).map(r => r.txid)

		expect(foundIds.length, 'should return 2 records').eq(2)
		expect(!foundIds.includes(unfinished.txid), 'should not include unfinished record').eq(true)
		expect(!foundIds.includes(finished1_000_000.txid),  `should not include record above ${maxHeight}`).eq(true)
		expect(foundIds.includes(mockRecord1.txid), 'should include mockRecord1').eq(true)
		expect(foundIds.includes(mockRecord2.txid), 'should include mockRecord2').eq(true)

	})

})