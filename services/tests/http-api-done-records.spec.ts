process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'chai-as-promised'
import {  } from 'mocha'
import * as DoneRecords from '../src/http-api/done-records'
import knexCreate from '../src/common/utils/db-connection'
import { TxRecord } from '../src/common/shepherd-plugin-interfaces/types'
import sinon from 'sinon'
import * as MoveRecords from '../src/http-api/move-records'
import { equal } from 'assert'

const knex = knexCreate()

describe('http-api done-records tests', ()=>{

	const mockRecord100: TxRecord = {
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
	const mockRecord200: TxRecord = {
		...mockRecord100, 
		txid: 'MOCK_RECORD3_456789012345678901234567890123', 
		height: 200,
	}

	beforeEach(async function () {
		await knex('inbox_txs').insert([ mockRecord100, mockRecord200 ])
	})
	afterEach(async function () {
		sinon.restore()
		await knex('inbox_txs').delete()
		await knex('txs').delete()
	})

	it(`should init`, async()=>{

		console.log('about to call doneInit for the first time')
		const init = await DoneRecords.doneInit()

		expect(init).to.be.an('array')
		expect(init).to.have.lengthOf(2)
		expect(init[0]).to.have.property('txid', mockRecord100.txid)
		expect(init[0]).to.have.property('height', mockRecord100.height)
		expect(init[1]).to.have.property('txid', mockRecord200.txid)
		expect(init[1]).to.have.property('height', mockRecord200.height)
	})

	it('should add/move records that are done and height < pass2height', async()=>{
		await DoneRecords.doneInit() //manually init

		//spy on moveInboxToTxs
		const spyMoveInboxToTxs = sinon.spy(MoveRecords, 'moveInboxToTxs')

		//set the height for moving
		const stubPasss2Height = sinon.stub(DoneRecords, 'pass2Height')
		.onCall(0).resolves(150)
		.onCall(1).resolves(250)

		// N.B. module property `last` could run over time and break this test!
		const res = await DoneRecords.doneAdd(mockRecord200.txid, mockRecord200.height)
		expect(res, 'added one record to done').to.equal(2)

		let count = await DoneRecords.moveDone()
		expect(stubPasss2Height.callCount, 'call pass2Height once').to.equal(1)
		expect(stubPasss2Height.lastCall.returnValue, 'pass2height is now 150').to.eventually.equal(150)
		expect(spyMoveInboxToTxs.lastCall.args[0], 'moveInboxToTxs called with').deep.eq([mockRecord100.txid])
		expect(count, 'moved one record to txs').to.equal(1)
		
		count = await DoneRecords.moveDone() //pass2height is now 250
		expect(stubPasss2Height.callCount, 'call pass2Height twice').to.equal(2)
		expect(stubPasss2Height.lastCall.returnValue, 'pass2height is now 250').to.eventually.equal(250)
		expect(spyMoveInboxToTxs.lastCall.args[0], 'moveInboxToTxs called with').deep.eq([mockRecord200.txid])
		expect(count, 'moved one more record to txs').to.equal(1)

	})

})
