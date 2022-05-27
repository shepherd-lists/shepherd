process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import { dataStream } from '../src/fetchers/fetchers'
import sinon from 'sinon'
import axios from 'axios'
import { PassThrough } from 'stream'
import * as DbUpdate from '../src/common/utils/db-update-txs'

/* these are now being mocked, but the responses have been changing lately on the gateway (2022-05-24) */
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

	it('tests a good stream gets processed (using live txid)', (done)=> {
		dataStream(goodMsgId, goodTxid).then(ds=>{
			expect(ds).to.exist
			ds.on('end',()=>{
				done()
			})
		})
	}).timeout(0)

	it('tests a NO_DATA stream gets processed', (done)=> {
		const mockStream = new PassThrough()
		//@ts-ignore
		mockStream.setTimeout = (t: number, cb: Function) => setTimeout(cb, 1000)
		const fakeAxios = sinon.stub(axios, 'get').resolves({ 
			data: mockStream, headers: { 'content-length': 123 }
		})
		//quieten log noise
		sinon.stub(DbUpdate, 'dbNoDataFound').resolves() //we're not testing db connectivity here.

		dataStream(nodataMsgId, 'txid-no-data').then(ds=>{
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
		
		dataStream(partialdataMsgId, 'txid-partial-data').then(ds =>{
			expect(fakeAxios.called).true
			ds.on('end', ()=> {
				done() 
			})
		})
	}).timeout(0)


})

