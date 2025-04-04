import { expect } from 'chai'
import {  } from 'mocha'
import { InflightsRecord, TxRecord, TxScanned } from '../src/common/shepherd-plugin-interfaces/types'
import dbConnection from '../src/common/utils/db-connection'
import { server } from '../src/http-api' //start the http interface server
import axios, { AxiosError } from 'axios'
import { APIFilterResult } from '../src/common/shepherd-plugin-interfaces'

const knex = dbConnection()

const mockRecord: TxScanned = {
	txid: 'MOCK_RECORD_3456789012345678901234567890123',
	content_size: '100',
	content_type: 'test/dummy',
	height: 123,
	parent: null,
	owner: '123456789_123456789_123456789_123456789_123',
}

describe('http-api tests', ()=>{

	/* insert mock tx records into db */
	beforeEach(async function () {
		this.timeout(5000)

		await knex<TxRecord>('inbox').insert(mockRecord)
		await knex<InflightsRecord>('inflights').insert({
			txid: mockRecord.txid,
		})
	})
	/* remove mock records after testing */
	afterEach(async function () {
		await knex<TxRecord>('inflights').delete()
		await knex<TxRecord>('inbox').delete()
	})

	after(()=>{
		server.close(e=>e && console.log('error closing server', e))
	})

	it('1. tests that a tx record gets updated', async()=>{
		const data: APIFilterResult = {
			txid: mockRecord.txid,
			filterResult: { flagged: false,	}
		}
		const res = await axios.post('http://localhost:84/postupdate', data)
		expect(res.status).eq(200)
	}).timeout(5000)

	it('2. tests that a non-existant record gets rejected', async()=>{
		const data: APIFilterResult = {
			txid: mockRecord.txid.replace(/[1-9]/g, 't'),
			filterResult: { flagged: false,	}
		}
		try{
			const res = await axios.post('http://localhost:84/postupdate', data)
			expect.fail('axios should reject')
		}catch(e){
			if(axios.isAxiosError(e)){
				expect((<AxiosError>e).response!.status).eq(406)
			}else{ throw e }
		}
	}).timeout(5000)

	it('3. tests that a badly formed txid in the payload get rejected', async()=>{
		expect(1)
		const data: APIFilterResult = {
			txid: 'this-is-a-bad-txid',
			filterResult: { flagged: false,	}
		}
		try{
			const res = await axios.post('http://localhost:84/postupdate', data)
			expect.fail('axios should reject')
		}catch(e){
			if(axios.isAxiosError(e)){
				expect((<AxiosError>e).response!.status).eq(400)
			}else{ throw e }
		}
	}).timeout(5000)

	it('4. tests that a badly formed payloads get rejected', async()=>{
		expect(1)
		const data = {
			notxid: 'no txid in the payload',
			filterResult: { flagged: false,	},
		}
		try{
			await axios.post('http://localhost:84/postupdate', data)
			expect.fail('axios should reject')
		}catch(e){
			if(axios.isAxiosError(e)){
				expect((<AxiosError>e).response!.status).eq(400)
			}else{ throw e }
		}
	}).timeout(5000)

	it('5. tests that a badly result in the payload get rejected', async()=>{
		expect(1)
		const data = {
			txid: mockRecord.txid,
			filterResult: {
				scores: 'scores are optional. flagged || data_reason are not.'
			}
		}
		try{
			await axios.post('http://localhost:84/postupdate', data)
			expect(true, 'test should fail').false
		}catch(e){
			if(axios.isAxiosError(e)){
				expect((<AxiosError>e).response!.status).eq(400)
			}else{ throw e }
		}
	}).timeout(5000)

	it('6. should calculate the byte-range for a txid with top_score_value > 0.9', async()=>{
		const data: APIFilterResult = {
			txid: 'PGE1rpLLKjQHNdTGF-NlNZ2cvKWuZwLCtRQCJcX_-88', // a small jpeg
			filterResult: {
				flagged: false,
				top_score_value: 0.95,
				top_score_name: 'test',
			}
		}
		await knex<TxRecord>('inbox').insert({
			txid: data.txid,
			content_size: '100',
			content_type: 'image/jpeg',
			height: 123,
			parent: null,
		})

		const res = await axios.post('http://localhost:84/postupdate', data)

		expect(res.status, 'http-api returned an error code').eq(200)
		const rec = (await knex<TxRecord>('inbox').select().where({ txid: data.txid }))[0]
		expect(rec.byte_start).to.exist
		expect(rec.byte_end).to.exist
		expect(rec.byte_start).eq('140085963825398')
		expect(rec.byte_end).eq('140085964087542')

	}).timeout(5000)

})