import { expect } from 'chai'
import {  } from 'mocha'
import sinon from 'sinon'
import { createReadStream, readFileSync } from 'fs'
import { filetypeCheck } from '../src/fetchers/fileType'
import { FetchersStatus } from '../src/common/constants'
import * as dbStub from '../src/common/utils/db-update-txs'
import * as s3Stub from '../src/fetchers/s3Services'


describe('fetchers-filetypeCheck tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a good stream does not emit an error', async()=> {
		const rs = createReadStream(`${__dirname}/fixtures/test.png`)
		const buffer = readFileSync(`${__dirname}/fixtures/test.png`)

		rs.on('error', e => {
			expect(true, `error ${e.message} should not have been emitted`).false
		})

		const res = await filetypeCheck(rs, buffer, 'txid-good-png', 'image/png')
		expect(res).true
	}).timeout(0)

	it('tests a BAD_MIME stream aborts and error thrown', async()=> {
		const rs = createReadStream(`${__dirname}/fixtures/drums.mid`)
		const buffer = readFileSync(`${__dirname}/fixtures/drums.mid`)
		// we're not testing these
		const stubDbWrongMime = sinon.stub(dbStub, 'dbWrongMimeType').resolves()
		const spyS3Delete = sinon.stub(s3Stub, 's3Delete')

		const BAD_MIME: FetchersStatus = 'BAD_MIME'
		rs.on('error', e => {
			expect(e.message).eq(BAD_MIME)
			rs.destroy() //clean up
		})

		await filetypeCheck(rs, buffer, 'txid-bad-mime', 'image/fake-mime')

		expect(stubDbWrongMime.calledOnce, 'dbWrongMimeType should be called once').true
		expect(spyS3Delete.calledOnce, 's3Delete should be called once').true
	}).timeout(0)

})