process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import { SQS } from 'aws-sdk'
import { s3Stream } from '../src/fetchers/s3Stream'
import sinon from 'sinon'
import axios from 'axios'
import { PassThrough } from 'stream'
import { createReadStream } from 'fs'


describe('fetchers-s3Stream tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a good stream gets uploaded', async()=> {
		const s = createReadStream(`${__dirname}/assets/test.png`)

		const res = await s3Stream(s, 'image/png', 'txid-good')
		expect(res).eq('OK')
	}).timeout(0)

	it('tests a NO_DATA stream aborts', async()=> {
		const mockStream = new PassThrough()
		setTimeout(()=>{
			mockStream.emit('error', new Error('NO_DATA'))
		}, 0)

		const res = await s3Stream(mockStream,'image/gif', 'txid-nodata')
		expect(res).eq('NO_DATA')
	}).timeout(0)


})