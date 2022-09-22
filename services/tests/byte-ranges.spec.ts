process.env['NODE_ENV'] = 'test'
import 'mocha'
import { expect } from 'chai'
import { byteRanges } from '../src/webserver/byteRanges'
import dbConnection from '../src/common/utils/db-connection'
import { TxRecord } from '../src/common/types'

const db = dbConnection()

describe('byte-ranges tests', ()=>{

	/* test data we have know */

	const wantedId = 'I210xM6oaK2G2AnHH1tN49E-Nu_WPWosWHFSLz2UbQ0'
	const bundleId = 'Yn9PXQvhb1stfjVxJwY4Ei4aIrqUbYVVkwlQiah_8FQ'
	const wantedStart = 87742364821010n
	const wantedEnd = 87742364822091n
	const bundleStart = 87742364823170n + 1n - 3468n
	const chunkStart = 87742364819702n
	const chunkEnd = 87742365081846n


	before(async function() {
		this.timeout(0)
		try{
			/* set up data for 404 test */
			const checkId = await db<TxRecord>('txs').where({ txid: wantedId })
			if(checkId.length !== 1){
				await db<TxRecord>('txs').insert({txid: wantedId, content_type: 'text/plain', content_size: '321'})
			}
			await db<TxRecord>('txs').where({ txid: wantedId}).update({ byteStart: '0', byteEnd: '0', parent: bundleId, }) 
		}catch(e:any){
			console.log('error connecting to DB', JSON.stringify(e))
			process.exit(1)
		}
	})

	it('should return the correct byte range for an ans104 dataItem, and test reconstructed dataItem', async()=> {


		const { start, end } = await byteRanges(wantedId, bundleId)
		
		expect(start, 'byteStart should equal value').eq(chunkStart)
		expect(end, 'byteEnd should equal value').eq(chunkEnd)
		
		/* the following makes no sense any more with chunk aligned byte ranges */

		// //reconstuct dataItem from binary
		// const { data } = await axios.get('https://arweave.net/' + bundleId, { responseType: 'arraybuffer'})
		// const splicedData = (data as Buffer).subarray(
		// 	Number(byteStart - bundleStart), 
		// 	Number(byteEnd - bundleStart),
		// )

		// const dataItem = new DataItem(splicedData)
		// expect(dataItem.id).eq(wantedId)
		// expect(await dataItem.isValid(), 'recontructed dataItem should be valid').true

	}).timeout(0)


})
