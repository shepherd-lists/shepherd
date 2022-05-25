process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import sinon from 'sinon'
import { PassThrough } from 'stream'
import { createReadStream } from 'fs'
import { filetypeStream } from '../src/fetchers/fileTypeStream'
import { FetchersStatus } from '../src/common/constants'


describe('fetchers-filetypeStream tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a good stream does not emit an error', async()=> {
		const rs = createReadStream(`${__dirname}/assets/test.png`)

		const res = await filetypeStream(rs, 'txid-good-png', 'image/png')
		expect(res).true
	}).timeout(0)

	it('tests a BAD_MIME stream aborts and error thrown', async()=> {
		const BAD_MIME: FetchersStatus = 'BAD_MIME'
		const mockStream = new PassThrough()
		mockStream.push('this is not media content')
		mockStream.end()

		mockStream.on('error', e => {
			expect(e.message).eq(BAD_MIME)
			mockStream.destroy() //clean up
		}) 

		try{
			const res = await filetypeStream(mockStream, 'txid-bad-mime', 'image/fake-mime')
			expect(true).false // we shouldn't get here, make sure test fails
		}catch(e:any){
			expect(e.message).eq(BAD_MIME)
		}
	}).timeout(0)

})