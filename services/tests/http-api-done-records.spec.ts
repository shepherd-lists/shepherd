process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import * as DoneRecords from '../src/http-api/done-records'
import knexCreate from '../src/common/utils/db-connection'
import { TxRecord } from '../src/common/shepherd-plugin-interfaces/types'
import Sinon from 'sinon'

const knex = knexCreate()

describe('http-api done-records tests', ()=>{

	const mockRecord1: TxRecord = {
		txid: 'MOCK_RECORD1_456789012345678901234567890123',
		content_size: '100',
		content_type: 'test/dummy',
		height: 100,
		parent: 'mock_parent_3456789012345678901234567890123',
		flagged: false,
		valid_data: true,
		//@ts-ignore
		data_reason: null,
		last_update_date: new Date(),
	}
	const mockRecord2: TxRecord = {
		...mockRecord1,
		txid: 'MOCK_RECORD2_456789012345678901234567890123',
	}
	const mockRecord3: TxRecord = {
		...mockRecord1, 
		txid: 'MOCK_RECORD3_456789012345678901234567890123', 
		height: 200,
	}
	beforeEach(async function () {
		await knex('inbox_txs').insert([mockRecord1, mockRecord2, mockRecord3])
		await knex('outbox').insert([
			{ txid: mockRecord1.txid, height: mockRecord1.height }
		])
	})
	afterEach(async function () {
		await knex('inbox_txs').delete()
		await knex('txs').delete()
		await knex('outbox').delete()
	})

	it(`should init`, async()=>{

		const init = await DoneRecords.doneInit()

		expect(init).to.be.an('array')
		expect(init).to.have.lengthOf(1)
		expect(init[0]).to.have.property('txid', mockRecord1.txid)
		expect(init[0]).to.have.property('height', mockRecord1.height)
	})

	it('should add/move records that are done and height < pass2height', async()=>{
		await DoneRecords.doneInit() //manually init

		//set the height for moving
		const stubPasss2Height = Sinon.stub(DoneRecords, 'pass2Height')
		.onCall(0).resolves(150)
		.onCall(1).resolves(250)

		// N.B. module property `last` could run over time and break this test!
		const res = await DoneRecords.doneAdd(mockRecord3.txid, mockRecord3.height)
		expect(res, 'added one record to done').to.equal(2)

		let count = await DoneRecords.moveDone()
		expect(count, 'moved one record to txs').to.equal(1)
		count = await DoneRecords.moveDone() //pass2height is now 250
		expect(count, 'moved one more record to txs').to.equal(1)


	})

})
