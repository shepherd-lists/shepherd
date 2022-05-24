process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import sinon from 'sinon'
import { PassThrough } from 'stream'
import { createReadStream } from 'fs'
import { filetypeStream } from '../src/fetchers/fileTypeStream'


describe('fetchers-filetypeStream tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a good stream does not emit an error', async()=> {
		const rs = createReadStream(`${__dirname}/assets/test.png`)

		const res = await filetypeStream(rs, 'txid-good-png')
		expect(res).true
	}).timeout(0)

	it('tests a BAD_MIME stream aborts', async()=> {
		const mockStream = new PassThrough()
		mockStream.push('this is not media content')
		mockStream.end()

		mockStream.on('error', e => mockStream.destroy()) //clean up

		const res = await filetypeStream(mockStream, 'txid-bad-mime')
		expect(res).false
	}).timeout(0)

})