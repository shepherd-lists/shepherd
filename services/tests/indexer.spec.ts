process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import {  } from 'mocha'
import Sinon from 'sinon'
import * as Indexer from '../src/indexer/indexer'
import * as GqlHeight from '../src/common/utils/gql-height'
import dbConnection from '../src/common/utils/db-connection'

describe('indexer tests', ()=>{
	it(`tests ${Indexer.topAvailableBlock.name} does not let pass2 get ahead of pass1`, async()=>{
		let weave = 1_000_000
		let posn1 = 999_980
		let posn2 = 999_900
		const fakeGqlHeight = Sinon.stub(GqlHeight, 'gqlHeight').callsFake(async()=> weave)
		const fakeSleep = Sinon.stub(Indexer, 'sleep').callsFake(async()=>{})
		const fakeReadPosn = Sinon.stub(Indexer, 'readPosition').callsFake(async(indexName: string)=>
			indexName === 'indexer_pass1' ? posn1++ : posn2++
		)
		

		const pass1 = await Indexer.topAvailableBlock(posn1, 0, 'http://fake.url', 'indexer_pass1')
		const pass2 = await Indexer.topAvailableBlock(weave - 15, 15, 'http://fake.url', 'indexer_pass2')
		
		console.log({pass1, pass2})

		expect(fakeGqlHeight.callCount, 'gql call count').greaterThan(0)
		expect(pass1, 'pass1 end value').eq(weave)
		expect(pass2, 'pass2 end value').eq(pass1 - 15)
		expect(pass2, `pass2:${pass2} < pass1:${pass1}`).to.be.lessThan(pass1)
	}).timeout(0)
})