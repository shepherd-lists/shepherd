process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import { dataStream } from '../src/fetchers/fetchers'
import sinon from 'sinon'
import axios from 'axios'
import { PassThrough } from 'stream'
import * as DbUpdate from '../src/common/utils/db-update-txs'
import * as S3Utils from '../src/fetchers/s3Services'
import { FetchersStatus } from '../src/common/constants'
import { createReadStream } from 'fs'

/* these are now being mocked, but the responses have been changing lately on the gateway (2022-05-24) */
// some test datas
const goodTxid = 'FPuYjox6xWNlH4djbh7if81svPB1_U6UO8_qQnMVopg'
// const nodataTxid = 'MdOMjck45888zaIuS_VE8SY2jspssvUrDIJPUzVjiF8',
const nodataTxid = 'mKtVp1UVE7TScGBoGrZ8Qi741v2G06a-An8baaceY2M'
const partialdataTxid = 'emYGkiQ0wuu5_e0OJBV3itfLbXjRKmvBD1eIkkCS0c0'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('fetchers `dataStream` tests', ()=>{

	afterEach(()=> sinon.restore())

	it('tests a good stream gets processed (using live txid)', (done)=> {
		dataStream( goodTxid).then(ds=>{
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
			data: mockStream, headers: { 'content-length': 666 }
		})
		//quieten log noise
		sinon.stub(DbUpdate, 'dbNoDataFound').resolves() //we're not testing db connectivity here.

		dataStream( 'txid-no-data').then(ds=>{
			expect(ds).to.exist
			expect(fakeAxios.called).true
			ds.on('error', e =>{
				if(e.message==='NO_DATA'){
					done()
				}
			})
		})
	}).timeout(0)

	it('tests PARTIAL_DATA stream gets processed', (done)=> {
		const mockStream = new PassThrough() 
		//@ts-ignore
		mockStream.setTimeout = (t: number, cb: Function) => setTimeout(cb, 1000)
		const fakeAxios = sinon.stub(axios, 'get').resolves({ 
			data: mockStream, headers: { 'content-length': 1024 }
		})
		mockStream.push('fake-partial-data890 12345678901234567890 12345678901234567890 1234567890') //73 bytes 
		mockStream.push('fake-partial-data890 12345678901234567890 12345678901234567890 1234567890') //146 bytes
		
		dataStream( 'txid-partial-data').then(ds =>{
			expect(fakeAxios.called).true
			ds.on('end', ()=> {
				done() 
			})
		})
	}).timeout(0)

	it('tests partial/aborted stream with NEGLIGIBLE_DATA message gets processed', (done)=> {
		const mockStream = new PassThrough() 
		//@ts-ignore
		mockStream.setTimeout = (t: number, cb: Function) => setTimeout(cb, 1000)
		const fakeAxios = sinon.stub(axios, 'get').resolves({ 
			data: mockStream, headers: { 'content-length': 1024 }
		})
		mockStream.push('not much data here')
		const stubDbNegligible = sinon.stub(DbUpdate, 'dbNegligibleData').resolves()
	
		mockStream.on('error', e=> {
			const NEGLIGIBLE_DATA: FetchersStatus = 'NEGLIGIBLE_DATA'
			expect(e.message, 'e.message should be NEGLIGIBLE_DATA').eq(NEGLIGIBLE_DATA)
			expect(fakeAxios.called, 'fakeAxios should be called').true
			expect(stubDbNegligible.callCount, 'dbNegligibleData should be called once').eq(1)
			done()
		})

		dataStream('txid-aborted-negligible-data')

	}).timeout(0)
 	
	it('tests NEGLIGIBLE_DATA stream gets processed', async()=> {
		const rs = createReadStream(`${__dirname}/`+'./fixtures/negligible-size.data')
		let setTimeoutCalled = false
		//@ts-ignore
		rs.setTimeout = (t: number, cb: Function) => setTimeout(()=>{setTimeoutCalled = true}, 10000)
		
		const fakeAxios = sinon.stub(axios, 'get').resolves({ 
			data: rs, headers: { 'content-length': 23 }
		})
		const stubDbNegligible = sinon.stub(DbUpdate, 'dbNegligibleData').resolves('OK')
		const stubS3Delete = sinon.stub(S3Utils, 's3Delete').resolves()


		await dataStream('txid-negligible-data')

		expect(fakeAxios.called, 'fakeAxios should be called').true
		expect(setTimeoutCalled, 'setTimeout should not be called before close').false

		//need to wait until the code we expect (close event handler) has run. unit test has timeout

		while(!stubDbNegligible.called) await sleep(10)
		expect(stubDbNegligible.callCount, 'dbNegligibleData should be called once').eq(1)
		while(!stubS3Delete.called) await sleep(10)
		expect(stubS3Delete.callCount, 's3Delete should be called once').eq(1)

	}).timeout(5000)



})

