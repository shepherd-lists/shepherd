process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import { dataStream,  } from '../src/fetchers/fetchers'
import sinon from 'sinon'
import axios, { Axios, AxiosError } from 'axios'
import { PassThrough } from 'stream'

// some test datas
const goodMsgId = 'msg-id-good' 
const goodTxid = 'FPuYjox6xWNlH4djbh7if81svPB1_U6UO8_qQnMVopg'
const nodataMsgId = 'msg-id-no-data'
// const nodataTxid = 'MdOMjck45888zaIuS_VE8SY2jspssvUrDIJPUzVjiF8',
const nodataTxid = 'mKtVp1UVE7TScGBoGrZ8Qi741v2G06a-An8baaceY2M'
const partialdataMsgId = 'msg-id-partial-data'
const partialdataTxid = 'emYGkiQ0wuu5_e0OJBV3itfLbXjRKmvBD1eIkkCS0c0'

describe('fetchers `dataStream` tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a good message gets processed', (done)=> {
		dataStream(goodMsgId, goodTxid).then(ds=>{
			expect(ds).to.exist
			ds.on('end',()=>{
				done()
			})
		})
	}).timeout(0)

	it('tests a NO_DATA message gets processed', (done)=> {
		const mockStream = new PassThrough()
		//@ts-ignore
		mockStream.setTimeout = (t: number, cb: Function) => setTimeout(cb, 1000)
		const fakeAxios = sinon.stub(axios, 'get').resolves({ 
			data: mockStream, headers: { 'content-length': 123 }
		})

		dataStream(nodataMsgId, nodataTxid).then(ds=>{
			expect(ds).to.exist
			expect(fakeAxios.called).true
			ds.on('error', e =>{
				if(e.message==='NO_DATA'){
					done()
				}
			})
		})
	}).timeout(0)

	it('tests PARTIAL_DATA message gets processed', (done)=> {
		const mockStream = new PassThrough() 
		//@ts-ignore
		mockStream.setTimeout = (t: number, cb: Function) => setTimeout(cb, 1000)
		const fakeAxios = sinon.stub(axios, 'get').resolves({ 
			data: mockStream, headers: { 'content-length': 123 }
		})
		mockStream.push('fake-partial-data')
		
		dataStream(partialdataMsgId, partialdataTxid).then(ds =>{
			expect(fakeAxios.called).true
			ds.on('end', ()=> {
				done() 
			})
		})
	}).timeout(0)


})

// describe('fetchers `dataStreamError` tests', ()=>{

// 	afterEach(()=> sinon.restore())

// 	it('tests a 404 txid gets processed', async()=> {
// 		const fakeAxios404error = {
// 			isAxiosError: true,
// 			response: { status: 404},
// 			// code: 'ECONNRESET', --we'll use this later
// 		}
// 		const mockAxios404 = sinon.stub(axios, 'get').throws(fakeAxios404error)

// 		const res = await dataStreamErrors('msg-id-404', 'txid-404')

// 		expect(res).to.exist
// 		expect(res).eq('404')
// 	}).timeout(0)

// 	it('tests a NO_DATA txid gets processed', async()=> {
// 		const mockStream = new PassThrough()
// 		//@ts-ignore
// 		mockStream.setTimeout = (t: number, cb: Function) => setTimeout(cb, 1000)
// 		const fakeAxios = sinon.stub(axios, 'get').resolves({ 
// 			data: mockStream, headers: { 'content-length': 123 }
// 		})
// 		mockStream.emit('error', new Error('NO_DATA'))
		

// 		const res = await dataStreamErrors('msg-id-no-data', 'txid-nodata')

// 		expect(res).to.exist
// 		expect(res).eq('404')
// 	}).timeout(0)

// })