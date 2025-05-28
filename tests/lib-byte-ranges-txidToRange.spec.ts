import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from 'node:test'

import { txidToRange } from '../libs/byte-ranges/txidToRange/txidToRange'
import { CHUNK_ALIGN_GENESIS, CHUNK_SIZE } from '../libs/byte-ranges/txidToRange/constants-byteRange'
import { ans104HeaderData } from '../libs/byte-ranges/txidToRange/ans104HeaderData'
import { byteRange102 } from '../libs/byte-ranges/txidToRange/byteRange102'


describe('txidToRange tests', () => {
	it('tests an L1 gets processed', async () => {
		const bytes = await txidToRange('Yn9PXQvhb1stfjVxJwY4Ei4aIrqUbYVVkwlQiah_8FQ', null, undefined)
		assert.equal(bytes.start, 87742364819702n)
		assert.equal(bytes.end, 87742365081846n)

	})

	it('tests an ans104 dataItem gets processed', async () => {
		const bytes = await txidToRange('I210xM6oaK2G2AnHH1tN49E-Nu_WPWosWHFSLz2UbQ0', 'Yn9PXQvhb1stfjVxJwY4Ei4aIrqUbYVVkwlQiah_8FQ', undefined)
		const chunkStart = 87742364819702n
		const chunkEnd = 87742365081846n
		assert.equal(bytes.start, chunkStart)
		assert.equal(bytes.end, chunkEnd)
	})

	it('tests a dataItem in a massive, 10,000 dataItem arbundles', async () => {
		/**
		 * maybe useful sometime:
		 * diIds[9999] = 'MItt5-z39ipds_lCcCASBpdb7ZLAWYZffOCYnGibXic'
		 */

		const parentId = 'MemPKvViQVcXnJdQWRlg9-jwNhSpTDH7g97MtzaQgEY'
		const parent = {
			size: 11227812n,
			offset: 88972798718874n,
			start: 88972798718874n - 11227812n, // 88972787491062n
			//  + 1n, // 88972787491063n
		}
		const headerLength = 32n + 10000n * 64n
		const dataItemIndex = 635n
		const dataItemsSize = 1053n * 10n + 1055n * 90n + 1057n * (dataItemIndex - 100n)
		const diRange = {
			start: parent.start + headerLength + dataItemsSize,
			end: parent.start + headerLength + dataItemsSize + 1057n,
		}
		const chunkStart = diRange.start - ((diRange.start - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE)
		const modEnd = (diRange.end - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE
		const chunkEnd = diRange.end + (modEnd === 0n ? 0n : CHUNK_SIZE - modEnd)

		const bytes = await txidToRange('0ATaqsTm3_u9HnfS6jj9OKM6ptM_CbbRgYeJYnX0ao8', parentId, undefined)
		assert.equal(bytes.start, chunkStart, 'should equal chunkStart')
		assert.equal(bytes.end, chunkEnd, 'should eq chunkEnd')
	})


})

describe('extra tests', () => {
	it('tests an L1 bundle gets processed', async () => {
		const bytes = await txidToRange('i1UYzkLruqwtNYHsHQCANkC-f48E6x7HIce8QXD25KA', null, undefined)
		assert.equal(bytes.start, 83105540251894n, 'start byte should match')
		assert.equal(bytes.end, 83106255118582n, 'end byte should match')

	})

	it('tests an ans104 dataItem gets processed', async () => {
		/**
		 * we are using the L1 tested in the previous test `i1UYzkLruqwtNYHsHQCANkC-f48E6x7HIce8QXD25KA`
		 * this is actually a bundle.
		 * there are 3000 DIs in this bundle. we are picking the first di i.e. index=0
		 * 1 chunk can hold 4096.5 index records => startByte == bundleStart
		 * calculations for endByte below.
		 */
		const bytes = await txidToRange('XGRfpi5HwZUd4FNPbrRBsoDP4awpZ_oJv1cFcn-DHqk', 'i1UYzkLruqwtNYHsHQCANkC-f48E6x7HIce8QXD25KA', undefined) //first di in the bundle
		const chunkStart = 83105540251894n //<= this is right
		const headerLength = 32n + (3000n * 64n)
		const diLength = 1203643n
		const end = (chunkStart + headerLength + diLength)
		const chunkEnd = end + (CHUNK_SIZE - (end - CHUNK_ALIGN_GENESIS) % CHUNK_SIZE)
		assert.equal(bytes.end, chunkEnd, 'should equal chunkEnd')
		assert.equal(bytes.start, chunkStart, 'should equal chunkStart')
	})

})

describe('stream ans104 header tests', () => {
	it('can read stream ans104', async () => {

		const res = await ans104HeaderData('MemPKvViQVcXnJdQWRlg9-jwNhSpTDH7g97MtzaQgEY')
		assert.equal(res.numDataItems, 10000, 'should be 10000 dataItems')
		assert.equal(res.diIds.length, res.diSizes.length, 'should be same numbers of sizes and ids')

	})
})

describe('ans102 tests', () => {
	// it('can read stream ans102', async () => {

	// 	//https://viewblock.io/arweave/tx/K-drBtpZ0C2-bPb0M5dFPla8FVKgPAOak-QqPoMKxnU

	// 	const res = await ans102HeaderData(`K-drBtpZ0C2-bPb0M5dFPla8FVKgPAOak-QqPoMKxnU`)
	// 	assert.equal(res.numDataItems, 2, 'should be 2 dataItems')
	// 	assert.equal(res.diIds.length, res.diSizes.length, 'should be same numbers of sizes and ids')

	// })

	it('tests a pre-align-epoch ans102 dataItem`s byte-range is clamped', async () => {
		const parentid = 'zv0DyLf95e9JcIDq9owI9Q2z1578m_ozFAUWsP4rrwM'
		const txid0 = 'ceBxKEAFdGAzHySCs7qGaZPOdITYu_V87XyLjLZuFPk'  // 0
		const txid1 = 'cLLgimFnpFyiRbOePC408BmyLbZzt8pr_gFpXKxD9Ng' // 1

		const bytes0 = await byteRange102(txid0, parentid)
		const chunkStart0 = 4397870113631n
		const chunkEnd0 = 4397870364650n
		assert.equal(bytes0.start, chunkStart0, 'should equal chunkStart0')
		assert.equal(bytes0.end, chunkEnd0, 'should equal chunkEnd0')

		const bytes1 = await byteRange102(txid1, parentid)
		const chunkStart1 = 4397870113631n
		const chunkEnd1 = 4397899835930n
		assert.equal(bytes1.start, chunkStart1, 'should equal chunkStart1')
		assert.equal(bytes1.end, chunkEnd1, 'should equal chunkEnd1')
	})

	it('tests a ans102 dataItem`s byte-range', async () => {
		const parentid = '34mHidbXtk3IpqEJ4Axgl1itjzCvw0-Vok-RaBxDa-c'
		const txid0 = 'BneBmCJKk88ox2P9tFFYCjU1o6N-1ZOT1kD9qGovRFg'

		const bytes0 = await byteRange102(txid0, parentid)
		const chunkStart0 = 93870741299446n
		const chunkEnd0 = 93870741561590n
		assert.equal(bytes0.start, chunkStart0, 'should equal chunkStart0')
		assert.equal(bytes0.end, chunkEnd0, 'should equal chunkEnd0')


	})

})

// describe('individual quick test',()=>{

// 	it('individual quick test', async()=> {
// 		const testId = '8igoU1KVoQZfajZMpMdVImp_pmPCRAEJWqOydRU0h20'
// 		const bytes = await txidToRange(testId)

// 		console.log(`*** fetching entire bundle data. this may take some time...`)
// 		const reader = axios.get(`https://arweave.net/${testId}`, {responseType:'stream'})


// 		assert.equal(bytes.start).eq(-7n)
// 		assert.equal(bytes.end).eq(-7n)

// 	})
// })

describe('Orphan data in DB tests', () => {
	it('should throw an error when an ans104 parent is not found', async () => {
		const badParent = '1234567890123456789012345678901234567890_-_'
		try {
			const bytes = await txidToRange('CagF6yAfaqIUYi0IHJ1FwmkdMqBxjVJBntyD1X1QF1U', badParent, undefined)
			assert.fail('should not get here. an error should have been thrown')
		} catch (err: unknown) {
			const e = err as Error
			/**
			 * in production this error will bubble up to slackLogger reporting.
			 * we will create suitable responses based on future data received.
			 * unfortunately using today's data i've found errors in both current gql endpoints.
			 * */
			assert.equal(e.message, `Parent ${badParent} not found using https://arweave.net/graphql or https://arweave-search.goldsky.com/graphql. id CagF6yAfaqIUYi0IHJ1FwmkdMqBxjVJBntyD1X1QF1U`)
		}
	})
})