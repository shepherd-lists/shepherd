process.env.S3_LOCAL = 'yes'
import { expect } from 'chai'
import 'mocha'
import { s3UploadStream } from '../src/fetchers/s3Services'
import sinon from 'sinon'
import { PassThrough } from 'stream'
import { createReadStream } from 'fs'
import { FetchersStatus } from '../src/common/constants'


describe('fetchers-s3Upload tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a good stream gets uploaded', async()=> {
		const s = createReadStream(`${__dirname}/`+'./fixtures/test.png')

		const res = await s3UploadStream(s, 'image/png', 'txid-s3upload-good')
		expect(res).eq('OK')
	}).timeout(0)

	it('tests a NO_DATA stream aborts', async()=> {
		const mockStream = new PassThrough()
		setTimeout(()=>{
			mockStream.emit('error', new Error('NO_DATA'))
		}, 0)

		const res = await s3UploadStream(mockStream,'image/gif', 'txid-s3upload-nodata')
		expect(res).eq('ABORTED')
	}).timeout(0)

	it('tests a NEGLIGIBLE_DATA stream aborts', async()=> {
		const mockStream = new PassThrough()
		setTimeout(()=>{
			const NEGLIGIBLE_DATA: FetchersStatus = 'NEGLIGIBLE_DATA'
			mockStream.emit('error', new Error('NEGLIGIBLE_DATA'))
		}, 0)

		const res = await s3UploadStream(mockStream,'image/gif', 'txid-s3upload-negligibledata')
		expect(res).eq('ABORTED')
	}).timeout(0)

	it('tests a BAD_MIME stream aborts', async()=> {
		const mockStream = new PassThrough()
		setTimeout(()=>{
			const BAD_MIME: FetchersStatus = 'BAD_MIME'
			mockStream.emit('error', new Error('BAD_MIME'))
		}, 0)

		const res = await s3UploadStream(mockStream,'image/gif', 'txid-s3upload-badmime')
		expect(res).eq('ABORTED')
	}).timeout(0)

})