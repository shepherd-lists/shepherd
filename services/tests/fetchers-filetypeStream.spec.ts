process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import sinon from 'sinon'
import { PassThrough } from 'stream'
import { createReadStream } from 'fs'
import { filetypeStream } from '../src/fetchers/fileTypeStream'
import { FetchersStatus } from '../src/common/constants'
import * as dbStub from '../src/common/utils/db-update-txs'
import * as s3Stub from '../src/fetchers/s3Services'


describe('fetchers-filetypeStream tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a good stream does not emit an error', async()=> {
		const rs = createReadStream(`${__dirname}/fixtures/test.png`)

		const res = await filetypeStream(rs, 'txid-good-png', 'image/png')
		expect(res).true
	}).timeout(0)

	it('tests a BAD_MIME stream aborts and error thrown', async()=> {
		const rs = createReadStream(`${__dirname}/fixtures/drums.mid`)
		// we're not testing these
		const stubDbWrongMime = sinon.stub(dbStub, 'dbWrongMimeType').resolves()
		const spyS3Delete = sinon.stub(s3Stub, 's3Delete')
		
		const BAD_MIME: FetchersStatus = 'BAD_MIME'
		rs.on('error', e => {
			expect(e.message).eq(BAD_MIME)
			rs.destroy() //clean up
		}) 

		try{
			await filetypeStream(rs, 'txid-bad-mime', 'image/fake-mime')
			expect(true).false // we shouldn't get here, make sure test fails
		}catch(e:any){
			expect(e.message).eq(BAD_MIME)
		}
		expect(stubDbWrongMime.calledOnce, 'dbWrongMimeType should be called once').true
		expect(spyS3Delete.calledOnce, 's3Delete should be called once').true
	}).timeout(0)

})