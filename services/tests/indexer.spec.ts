process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import sinon from 'sinon'
import * as Indexer from '../src/indexer/indexer'
import * as GqlHeight from '../src/common/utils/gql-height'
import * as IndexBlocks from '../src/indexer/index-blocks'
import { TxRecord, TxScanned } from '../src/common/shepherd-plugin-interfaces/types'
import dbConnection from '../src/common/utils/db-connection'

const knex = dbConnection()

describe('indexer tests', ()=>{
	
	const height1record1: TxScanned = { 
		txid: '01-abcdefghijabcdefghijabcdefghijabcdefghij', content_size: '123', content_type: 'fake', height: 1, parent: null 
	}
	const height1record2: TxScanned = { 
		txid: '02-abcdefghijabcdefghijabcdefghijabcdefghij', content_size: '123', content_type: 'fake', height: 1, parent: null 
	}
	const height2record3: TxScanned = {
		txid: '03-abcdefghijabcdefghijabcdefghijabcdefghij', content_size: '123', content_type: 'fake', height: 2, parent: null
	}


	before(async()=>{
		/** insert first test txs into pgdb-test inbox_txs table */
		await knex('inbox_txs').insert([ height1record1, height1record2 ])
	})

	afterEach(()=>{
		sinon.restore()
	})

	it(`tests ${Indexer.topAvailableBlock.name} does not let pass2 get ahead of pass1`, async()=>{
		let weave = 1_000_000
		let posn1 = 999_980
		let posn2 = 999_900
		const fakeGqlHeight = sinon.stub(GqlHeight, 'gqlHeight').callsFake(async()=> weave)
		const fakeSleep = sinon.stub(Indexer, 'sleep').callsFake(async()=>{})
		const fakeReadPosn = sinon.stub(Indexer, 'readPosition').callsFake(async(indexName: string)=>
			indexName === 'indexer_pass1' ? posn1++ : posn2++
		)
		

		const pass1 = await Indexer.topAvailableBlock(posn1, 0, 'http://fake.url', 'indexer_pass1') //pass1 confirmations 0
		const pass2 = await Indexer.topAvailableBlock(weave - 15, 15, 'http://fake.url', 'indexer_pass2')
		
		console.log({pass1, pass2})

		expect(fakeGqlHeight.callCount, 'gql call count').greaterThan(0)
		expect(pass1, 'pass1 end value').eq(weave)
		expect(pass2, 'pass2 end value').eq(pass1 - 15)
		expect(pass2, `pass2:${pass2} < pass1:${pass1}`).to.be.lessThan(pass1)

		//TODO: add further tests for pass2?

	}).timeout(0)

	it(`tests ${IndexBlocks.insertRecords.name} wipes byte-range columns for pass1 duplicate records`, async()=>{
		try{
			await knex<TxRecord>('inbox_txs').update({ byteStart: '1', byteEnd: '2' }).where({ txid: height1record1.txid })
		}catch(e:any){
			expect.fail(`knex update threw an error setting up the test: ${e.message}`)
		}

		try{
			//this should conflict and overwrite the existing byteStart/byteEnd values 
			await IndexBlocks.insertRecords([ height1record1 ], 'indexer_pass1', 'http://fake.url')
			const [ {byteStart, byteEnd} ] = await knex<TxRecord>('inbox_txs').select('byteStart', 'byteEnd').where({ txid: height1record1.txid })
			expect(byteStart, 'byteStart').eq(null)
			expect(byteEnd, 'byteEnd').eq(null)

		}catch(e:any){
			expect.fail(`insertRecords threw an error: ${e.message}`)
		}
	})

	it(`tests ${IndexBlocks.insertRecords.name} pass2 skips dupes, updates records with > height, inserts new records`, async()=>{
		const fakeHeight = 777
		const updatedRecord = { ...height1record1, height: fakeHeight, parent: '1234567890123456789012345678901234567890abc' }
		const newRecord = height2record3
		try{
			IndexBlocks.insertRecords([ height1record1, updatedRecord, newRecord ], 'indexer_pass2', 'http://fake.url')
			
			const [ {height, parent} ] = await knex<TxRecord>('inbox_txs').select('*').where({ txid: height1record1.txid })
			const newRecordExists = await knex<TxRecord>('inbox_txs').select('*').where({ txid: newRecord.txid })

			expect(height, 'height should have been updated').eq(fakeHeight)
			expect(parent, 'parent should have been updated').eq(updatedRecord.parent)

			expect(newRecordExists.length, 'new record should have been inserted').eq(1)
			expect(newRecordExists[0].txid, 'new record txid').eq(newRecord.txid)

		}catch(e:any){
			expect.fail(`knex threw an error: ${e.message}`)
		}
	})

})