process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import { SQS } from 'aws-sdk'
import { streamer } from '../src/fetchers/fetchers'

// some test sqs messages
const goodMsg: SQS.Message = {
	MessageId: 'msg-id-good',
	ReceiptHandle: '001',
	Body: JSON.stringify({
		txid: 'FPuYjox6xWNlH4djbh7if81svPB1_U6UO8_qQnMVopg',
		content_type: 'image/png',
	})
}
const nodataMsg: SQS.Message = {
	MessageId: 'msg-id-no-data',
	ReceiptHandle: '002',
	Body: JSON.stringify({
		txid: 'MdOMjck45888zaIuS_VE8SY2jspssvUrDIJPUzVjiF8',
		content_type: 'video/mp4',
	})
}
const partialdataMsg: SQS.Message = {
	MessageId: 'msg-id-partial-data',
	ReceiptHandle: '003',
	Body: JSON.stringify({
		txid: 'emYGkiQ0wuu5_e0OJBV3itfLbXjRKmvBD1eIkkCS0c0',
		content_type: 'video/mp4',
	})
}

describe('fetchers tests', ()=>{

	it('tests a good message gets processed', async()=> {
		const res = await streamer(goodMsg)
		console.log('UNIT TEST RESULT:', res)
		expect(res).eq('OK')
	}).timeout(0)

	it('tests a NO_DATA message gets processed', async()=> {
		const res = await streamer(nodataMsg)
		console.log('UNIT TEST RESULT:', res)
		expect(res).eq('NO_DATA')
	}).timeout(0)

	it('tests PARTIAL_DATA message gets processed', async()=> {
		const res = await streamer(partialdataMsg)
		console.log('UNIT TEST RESULT:', res)
		expect(res).eq('OK')
	}).timeout(0)

})