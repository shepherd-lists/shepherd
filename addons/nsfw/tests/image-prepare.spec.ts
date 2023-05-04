process.env['NODE_ENV'] = 'test'
import col from 'ansi-colors'
import { expect } from 'chai'
import * as imageFilter from '../src/rating/filter-host'
import getDbConnection from './utils/dbConnection-for-tests-only'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import sinon from 'sinon'
import axios from 'axios'
import { NO_DATA_TIMEOUT } from '../src/constants'
import { readFileSync } from 'fs'
import { S3 } from 'aws-sdk'

const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.SQS_LOCAL==='yes' && { 
		endpoint: process.env.S3_LOCAL_ENDPOINT!, 
		region: 'dummy-value',
		s3ForcePathStyle: true, // *** needed with minio ***
	}),
	maxRetries: 1,
})
const s3Upload = async (txid:string) => s3.upload({
	Bucket: 'shepherd-input-mod-local', 
	Key: txid,
	Body: readFileSync(`${__dirname}/`+`./fixtures/${txid}`),
}).promise()

const db = getDbConnection()

describe('image-prepare tests', ()=> {

	// const tx404 = 'gf7bi2cuBcLA5Wep7z81eQ2mqOL8SUx2vqjWuJABx-E'
	const txCorrupt = 'pt098PDGzPlYoZW0gO_lbkC6I5XlKXa3_5qXRe4dFcg'
	// const txTimeout = 'mKtVp1UVE7TScGBoGrZ8Qi741v2G06a-An8baaceY2M'
	const txNonImageMime = 'TdHwcRVtU0PH-gMSKfyBVxvnTQTCC9Bm1KdWZXfc8TI'
	const txWrongImageMime = 'fUIsALvHzGb5IwkTmUBC_Pie8kL7JRlgwAd_Ue76-pw' //png

	const txPartial = 'DFzY841LjCmoEZ0ou4V5uFoorOcEvANQzAMi-CA93lA'


	before( async function(){
		this.timeout(0)

		try{

			/* set up data for corrupt file test */
			await s3Upload(txCorrupt)
			const resCorrupt = await db<TxRecord>('txs').where({ txid: txCorrupt })
			if(resCorrupt.length !== 1){
				await db<TxRecord>('txs').insert({txid: txCorrupt, content_type: 'image/png', content_size: '123'})
			}
			await db<TxRecord>('txs').where({ txid: txCorrupt}).update({ data_reason: 'timeout'}) //set to !mimetype

			/* set up data for non-image mimetype test */
			await s3Upload(txNonImageMime)
			const resNonImageMime = await db<TxRecord>('txs').where({ txid: txNonImageMime })
			if(resNonImageMime.length !== 1){
				await db<TxRecord>('txs').insert({txid: txNonImageMime, content_type: 'image/png', content_size: '123'})
			}else{
				await db<TxRecord>('txs').where({ txid: txNonImageMime}).update({ content_type: 'image/png'}) //set to !timeout
			}

			/* set up data for non-image mimetype test */
			await s3Upload(txWrongImageMime)
			const resWrongImageMime = await db<TxRecord>('txs').where({ txid: txWrongImageMime })
			if(resWrongImageMime.length !== 1){
				await db<TxRecord>('txs').insert({txid: txWrongImageMime, content_type: 'image/jpeg', content_size: '123'})
			}else{
				await db<TxRecord>('txs').where({ txid: txWrongImageMime}).update({ content_type: 'image/jpeg'}) //set to !timeout
			}


		}catch(e:any){
			console.log(col.redBright('error connecting to DB'), JSON.stringify(e))
			process.exit(1)
		}
	})

	after(async function () {
		/* remove mock records after testing */
		const ids = [
			// tx404,
			txCorrupt,
			// txTimeout,
			txNonImageMime,
			txWrongImageMime,
		]
		await Promise.all(ids.map(id=>{
			db<TxRecord>('txs').delete().where({ txid: id })
		}))
	})

	afterEach(()=> sinon.restore())


	it('tests handling image with non-image mimetype', async()=>{
		const res = await imageFilter.checkImageTxid(txNonImageMime, 'image/png')
		expect(res).true // true: handled the wrong mimetype
		
		const check = await db<TxRecord>('txs').where({ txid: txNonImageMime})
		expect(check.length).eq(1)
		expect(check[0].content_type).eq('video/mp4')
	}).timeout(0)

	it('tests handling image with wrong image mimetype', async()=>{
		const res = await imageFilter.checkImageTxid(txWrongImageMime, 'image/jpeg')
		expect(res).true // true: handled the wrong mimetype
		
		const check = await db<TxRecord>('txs').where({ txid: txWrongImageMime})
		expect(check.length).eq(1)
		expect(check[0].content_type).eq('image/jpeg') //we dont change these anymore
	}).timeout(0)


	// /* this should be handled by the hosted plugin, not the harness */
	// it('tests handling corrupt image: mimetype undefined', async()=>{
	// 	const res = await imageFilter.checkImageTxid(txCorrupt, 'image/png')
	// 	expect(res).true // true: handled it
		
	// 	const check = await db<TxRecord>('txs').where({ txid: txCorrupt})

	// 	console.log({res, check})

	// 	expect(check.length).eq(1)
	// 	expect(check[0].valid_data).false
	// 	expect(check[0].data_reason).eq('corrupt')
	// }).timeout(0)

	
})



