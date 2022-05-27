process.env['NODE_ENV'] = 'test'
import sinon from 'sinon'
import chai, { expect } from 'chai'
import chaiPromised from 'chai-as-promised'
import * as Fetchers from '../src/fetchers/fetchers'
import * as S3Services from '../src/fetchers/s3Services'
import * as Filetype from '../src/fetchers/fileTypeStream'
import * as DbUpdate from '../src/common/utils/db-update-txs'
import axios from 'axios'
import { createReadStream } from 'fs'
import { SQS } from 'aws-sdk'
import { IncomingMessage } from 'http'
import { PassThrough } from 'stream'

chai.use(chaiPromised)


describe('fetchers `fetcherLoop` tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a single good stream gets processed', async()=> {

		/* set up mocks, stubs, spies, etc. */
		const mockGoodMsg: SQS.Message = {
			MessageId: 'msg-id-good',
			ReceiptHandle: '001',
			Body: JSON.stringify({
				txid: 'txid-fetcherLoop-good',
				content_type: 'image/png',
			})
		}
		sinon.stub(Fetchers, 'getMessage').resolves(mockGoodMsg) 
		const readStream = createReadStream(`${__dirname}/assets/test.png`)
		sinon.stub(Fetchers, 'dataStream').resolves(readStream as unknown as IncomingMessage)
		
		const spyFiletype = sinon.spy(Filetype, 'filetypeStream')
		const spyS3Stream = sinon.spy(S3Services, 's3UploadStream')
		const spyDeleteMessage = sinon.spy(Fetchers, 'deleteMessage')

		/* run the function to be tested */

		await Fetchers.fetcherLoop(false)

		/* check expected results */
		
		expect(spyFiletype.callCount).eq(1, 'filetypeStream was not called')
		expect(spyFiletype.firstCall.returnValue, "filetypeStream didn't return true").to.eventually.true

		expect(spyS3Stream.callCount).eq(1, 's3UploadStream was not called')
		expect(spyS3Stream.firstCall.returnValue).to.eventually.eq('OK', 's3UploadStream didn\'t return OK')
		
		expect(spyDeleteMessage.callCount).eq(1, 'deleteMessage was not called')
		
	}).timeout(0)


	it('tests a single BAD_MIME stream gets processed', async()=> {

		/* set up mocks, stubs, spies, etc. */

		sinon.stub(Fetchers, 'getMessage').resolves({
			MessageId: 'msg-id-bad-mime',
			ReceiptHandle: '001',
			Body: JSON.stringify({
				txid: 'txid-fetcherLoop-badmime',
				content_type: 'image/png',
			})
		}) 
		const mockStream = new PassThrough()
		sinon.stub(Fetchers, 'dataStream').resolves(mockStream as unknown as IncomingMessage)
		mockStream.push('this is not ')
		mockStream.push('image or video data')
		mockStream.end()

		const stubDb404 = sinon.stub(DbUpdate, 'dbNoDataFound404').resolves() 
		const stubDbBadMime = sinon.stub(DbUpdate, 'dbBadMimeFound').resolves() 
		
		const spyFiletype = sinon.spy(Filetype, 'filetypeStream')
		const spyS3Stream = sinon.spy(S3Services, 's3UploadStream')
		const spyDeleteMessage = sinon.spy(Fetchers, 'deleteMessage')

		/* run the function to be tested */

		await Fetchers.fetcherLoop(false)

		/* check expected results */
		
		expect(spyFiletype.callCount, 'filetypeStream was never called').eq(1)
		expect(spyFiletype.firstCall.returnValue).to.eventually.throw('bad mime', 'filetypeStream didn\'t throw')

		expect(spyS3Stream.callCount).eq(0, 's3UploadStream callCount not zero')
		expect(stubDb404.callCount).eq(0, 'dbNoDataFound404 callCount not zero')
		expect(stubDbBadMime.callCount).eq(1, 'dbBadMimeFound was not called')
		
		expect(spyDeleteMessage.callCount).eq(1, 'deleteMessage was not called')
		
	}).timeout(0)


	it('tests a single ERROR_404 stream gets processed', async()=> {

		/* set up mocks, stubs, spies, etc. */

		sinon.stub(Fetchers, 'getMessage').resolves({
			MessageId: 'msg-id-error-404',
			ReceiptHandle: '001',
			Body: JSON.stringify({
				txid: 'txid-fetcherLoop-error404',
				content_type: 'image/png',
			})
		}) 
		sinon.stub(Fetchers, 'dataStream').callsFake(()=>axios.get('http://httpstat.us/404')) 

		const stubDbNoDataFound404 = sinon.stub(DbUpdate, 'dbNoDataFound404').resolves() 
		const stubDbBadMimeFound = sinon.stub(DbUpdate, 'dbBadMimeFound').resolves() 
		
		const spyFiletype = sinon.spy(Filetype, 'filetypeStream')
		const spyS3Stream = sinon.spy(S3Services, 's3UploadStream')
		const spyDeleteMessage = sinon.spy(Fetchers, 'deleteMessage')

		/* run the function to be tested */

		await Fetchers.fetcherLoop(false)

		/* check expected results */
		
		expect(spyFiletype.callCount, 'filetypeStream should not get called').eq(0)
		expect(spyS3Stream.callCount).eq(0, 's3UploadStream should not be called')
		expect(stubDbNoDataFound404.callCount).eq(1, 'dbNoDataFound404 should be called')
		expect(stubDbBadMimeFound.callCount).eq(0, 'dbBadMimeFound should not be called')
		
		expect(spyDeleteMessage.callCount).eq(1, 'deleteMessage should be called')
		
	}).timeout(0)


	it('tests a single ECONNREFUSED stream gets processed', async()=> {

		/* set up mocks, stubs, spies, etc. */

		sinon.stub(Fetchers, 'getMessage').resolves({
			MessageId: 'msg-id-ECONNREFUSED',
			ReceiptHandle: '001',
			Body: JSON.stringify({
				txid: 'txid-fetcherLoop-ECONNREFUSED',
				content_type: 'image/png',
			})
		}) 
		sinon.stub(Fetchers, 'dataStream').callsFake(()=>axios.get('http://localhost:1')) 

		const stubDbNoDataFound404 = sinon.stub(DbUpdate, 'dbNoDataFound404').resolves() 
		const stubDbBadMimeFound = sinon.stub(DbUpdate, 'dbBadMimeFound').resolves() 
		
		const spyFiletype = sinon.spy(Filetype, 'filetypeStream')
		const spyS3Stream = sinon.spy(S3Services, 's3UploadStream')
		const spyDeleteMessage = sinon.spy(Fetchers, 'deleteMessage')

		/* run the function to be tested */

		await Fetchers.fetcherLoop(false)

		/* check expected results */
		
		expect(spyFiletype.callCount, 'filetypeStream should not get called').eq(0)
		expect(spyS3Stream.callCount).eq(0, 's3UploadStream should not be called')
		expect(stubDbNoDataFound404.callCount).eq(0, 'dbNoDataFound404 should not be called')
		expect(stubDbBadMimeFound.callCount).eq(0, 'dbBadMimeFound should not be called')
		
		expect(spyDeleteMessage.callCount).eq(0, 'deleteMessage should not be called') //most importantly
		
	}).timeout(0)


})

