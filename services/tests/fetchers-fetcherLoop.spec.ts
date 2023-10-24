import sinon from 'sinon'
import chai, { expect } from 'chai'
import chaiPromised from 'chai-as-promised'
import * as Fetchers from '../src/fetchers/fetchers'
import * as S3Services from '../src/fetchers/s3Services'
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
		const readStream = createReadStream(`${__dirname}/`+'./fixtures/test.png')
		sinon.stub(Fetchers, 'dataStream').resolves(readStream as unknown as IncomingMessage)

		const spyS3Stream = sinon.spy(S3Services, 's3UploadStream')
		const spyDeleteMessage = sinon.spy(Fetchers, 'deleteMessage')

		/* run the function to be tested */

		await Fetchers.fetcherLoop(false)

		/* check expected results */

		expect(spyS3Stream.callCount).eq(1, 's3UploadStream was not called')
		expect(spyS3Stream.firstCall.returnValue).to.eventually.eq('OK', 's3UploadStream didn\'t return OK')

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
				content_size: 404,
			})
		})
		sinon.stub(Fetchers, 'dataStream').callsFake(()=>axios.get('http://httpstat.us/404'))

		const stubDbNoDataFound404 = sinon.stub(DbUpdate, 'dbNoDataFound404').resolves()

		const spyS3Stream = sinon.spy(S3Services, 's3UploadStream')
		const spyDeleteMessage = sinon.spy(Fetchers, 'deleteMessage')

		/* run the function to be tested */

		await Fetchers.fetcherLoop(false)

		/* check expected results */

		expect(spyS3Stream.callCount).eq(0, 's3UploadStream should not be called')
		expect(stubDbNoDataFound404.callCount).eq(1, 'dbNoDataFound404 should be called')

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
				content_size: 666,
			})
		})
		sinon.stub(Fetchers, 'dataStream').callsFake(()=>axios.get('http://localhost:1'))

		const stubDbNoDataFound404 = sinon.stub(DbUpdate, 'dbNoDataFound404').resolves()

		const spyS3Stream = sinon.spy(S3Services, 's3UploadStream')
		const spyDeleteMessage = sinon.spy(Fetchers, 'deleteMessage')

		/* run the function to be tested */

		await Fetchers.fetcherLoop(false)

		/* check expected results */

		expect(spyS3Stream.callCount).eq(0, 's3UploadStream should not be called')
		expect(stubDbNoDataFound404.callCount).eq(0, 'dbNoDataFound404 should not be called')

		expect(spyDeleteMessage.callCount).eq(0, 'deleteMessage should not be called') //most importantly

	}).timeout(0)

	it('tests a single NEGLIGIBLE_DATA stream gets processed', async()=> {
		sinon.stub(Fetchers, 'getMessage').resolves({
			MessageId: 'msg-id-NEGLIGIBLE_DATA',
			ReceiptHandle: '001',
			Body: JSON.stringify({
				txid: 'txid-fetcherLoop-NEGLIGIBLE_DATA',
				content_type: 'image/png',
				content_size: 15,
			})
		})
		const mockStream = new PassThrough()
		mockStream.push('not enough data')
		// mockStream.push(null) leave the stream open so it can be aborted ?
		mockStream.end()
		sinon.stub(Fetchers, 'dataStream').resolves(mockStream as unknown as IncomingMessage)

		const spyDeleteMessage = sinon.spy(Fetchers, 'deleteMessage')
		const spyS3Stream = sinon.spy(S3Services, 's3UploadStream')

		setTimeout(()=> mockStream.emit('error', new Error('NEGLIGIBLE_DATA')))

		await Fetchers.fetcherLoop(false)

		expect(spyS3Stream.callCount, 's3Delete should be called once').eq(1)
		expect(spyS3Stream.firstCall.returnValue, 's3UploadStream should return `ABORTED`').to.eventually.eq('ABORTED')
		expect(spyDeleteMessage.callCount, 'deleteMessage should be called once').eq(1)


	}).timeout(0)

})

