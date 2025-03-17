process.env['NODE_ENV'] = 'test'
import 'mocha'
import { expect } from 'chai'
import { checkFrames } from '../src/rating/video/check-frames'
import { createScreencaps } from '../src/rating/video/screencaps'
import { processVids } from '../src/rating/video/process-files'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { VidDownloadRecord, VidDownloads } from '../src/rating/video/VidDownloads'
import { addToDownloads, videoDownload } from '../src/rating/video/downloader'
import {rimraf} from 'rimraf'
import dbConnection from './utils/dbConnection-for-tests-only'
import sinon from 'sinon'
import { PassThrough } from 'stream'
import axios from 'axios'
import { S3 } from 'aws-sdk'
import { readFileSync } from 'fs'
import * as harness from '../src/harness'
import shelljs from 'shelljs'
import { VID_TMPDIR } from '../src/constants'

const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.SQS_LOCAL==='yes' && {
		endpoint: process.env.S3_LOCAL_ENDPOINT!,
		region: 'dummy-value',
		s3ForcePathStyle: true, // *** needed with minio ***
	}),
	maxRetries: 1,
})

const knex = dbConnection()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const s3Upload = async (txid:string) => s3.upload({
	Bucket: 'shepherd-input-mod-local',
	Key: txid,
	Body: readFileSync(`${__dirname}/`+`./fixtures/${txid}`),
}).promise()
	.catch(e => {throw new Error(`ERROR IN TEST PREPARATION UPLOADING ${txid}`)})


describe('video-prepare tests', ()=> {

	before((done)=>{
		rimraf('temp-screencaps/./*').catch(e=>{
			console.log('error in before cleaning tempdir', e)
			done()
		})
	})

	afterEach( (done)=>{
		rimraf('temp-screencaps/./*').catch((e)=> {
			console.log('error in afterEach cleaning tempdir', e)
			done()
		})
	})

	afterEach(()=> sinon.restore())

	it('1. videoDownload: downloads a video', async()=> {
		//@ts-ignore
		const smallvid: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: '10108',
			txid: 'nSX3Qaz-r1NF2dJ4Xh-pMrD6VNt_5wmtu6AgezO3h9U',
			content_type: 'video/mp4',
		}
		await s3Upload(smallvid.txid)
		await knex<TxRecord>('txs').where('txid', smallvid.txid).delete()
		await knex<TxRecord>('txs').insert({ txid: smallvid.txid, content_type: 'video/mp4', content_size: '10108'})
		const res = await videoDownload(smallvid)
		while(smallvid.complete === 'FALSE') await sleep(500)
		expect(res).to.be.true
	}).timeout(0)

	// it('2. videoDownload: times out when no first byte', async()=> {
	// 	// @ts-ignore
	// 	const nodata: VidDownloadRecord = {
	// 		complete: 'FALSE',
	// 		content_size: '14343687',
	// 		txid: 'mKtVp1UVE7TScGBoGrZ8Qi741v2G06a-An8baaceY2M', //no data (it's actually a missing image)
	// 	}
	// 	await knex<TxRecord>('txs').where('txid', nodata.txid).delete()
	// 	await knex<TxRecord>('txs').insert({ txid: nodata.txid, content_type: 'video/mp4', content_size: '123'})

	// 	const mockStream = new PassThrough()
	// 	//@ts-ignore
	// 	mockStream.setTimeout = (t: number, cb: Function) => setTimeout(cb, 0)
	// 	const fakeAxios = sinon.stub(axios, 'get').resolves({
	// 		data: mockStream, headers: { 'content-length': 123 }
	// 	})

	// 	const res = await videoDownload(nodata)
	// 	expect(fakeAxios.called).true
	// 	expect(res).to.equal('no data timeout')
	// 	sinon.restore()
	// }).timeout(0)

	it('3. videoDownload: incorrect file-type can be detected & download aborted', async()=> {
		//@ts-ignore
		const notvid: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: '419080',
			txid: 'rbm6bKvIKhuui9wATaySbLDuRUKq1KLb8qmaihNpsbU', // an image file
		}
		await s3Upload(notvid.txid)
		await knex<TxRecord>('txs').where('txid', notvid.txid).delete()
		await knex<TxRecord>('txs').insert({ txid: notvid.txid, content_type: 'video/mp4', content_size: '123'})
		const res = await videoDownload(notvid)
		expect(res).false
	}).timeout(0)

	it('4. createScreencaps: create screencaps from video', async()=> {
		//@ts-ignore
		const vid: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: '229455',
			txid: 'MudCCqbbf--ktx1b0EMrhSdNWP3ZT9XnMJP-oC486cM',
			content_type: 'video/mp4',
		}
		await knex<TxRecord>('txs').where('txid', vid.txid).delete()
		await knex<TxRecord>('txs').insert({ txid: vid.txid, content_type: 'video/mp4', content_size: '123'})

		const folderpath = VID_TMPDIR + vid.txid + '/'
		shelljs.mkdir('-p', folderpath)
		shelljs.cp(`${__dirname}/fixtures/${vid.txid}`, folderpath)

		const frames = await createScreencaps(vid.txid)
		expect(frames.length).greaterThan(1)
		expect(frames.length).lessThanOrEqual(4) //ffmpeg sometimes creates 2,3,4 screencaps. not an error.
	}).timeout(0)

	it('5. checkFrames: check screencaps for nsfw content', async()=> {
		//@ts-ignore
		const vid: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: '229455',
			txid: 'MudCCqbbf--ktx1b0EMrhSdNWP3ZT9XnMJP-oC486cM',
			content_type: 'video/mp4',
		}
		await knex<TxRecord>('txs').where('txid', vid.txid).delete()
		await knex<TxRecord>('txs').insert({ txid: vid.txid, content_type: 'video/mp4', content_size: '123'})

		const folderpath = VID_TMPDIR + vid.txid + '/'
		shelljs.mkdir('-p', folderpath)
		shelljs.cp(`${__dirname}/fixtures/${vid.txid}`, folderpath)

		const frames = await createScreencaps(vid.txid)
		expect(frames.length).greaterThan(1)
		const checkId = await checkFrames(frames, vid.txid)
		expect(checkId).to.exist
		expect(checkId).eq(vid.txid)
		// if(checkId){ expect(checkId).equal(vid.txid) }
	}).timeout(0)

	it('6. full processing of a video', async()=>{
		//@ts-ignore
		const vid: TxRecord = {
			txid: 'nwIUNPF8R03uW0zrPHnR4aTAnDdExqv56fMbbMQoHCA',
			content_type: 'video/mp4',
			content_size: '16498',
		}
		await s3Upload(vid.txid)
		/* set up DB data */
		await knex<TxRecord>('txs').where('txid', vid.txid).delete()
		await knex<TxRecord>('txs').insert(vid)

		await addToDownloads({
			content_size: vid.content_size,
			content_type: vid.content_type,
			txid: vid.txid,
			receiptHandle: 'dummy-receiptHandle',
		})
		//@ts-ignore
		let dl: VidDownloadRecord = {}
		for(const d of VidDownloads.getInstance()){
			if(d.txid === vid.txid) dl = d
		}
		while(dl.complete === 'FALSE') await sleep(500)
		expect(dl.complete).to.eq('TRUE')
		sinon.stub(harness, 'cleanupAfterProcessing').resolves()
		await processVids()
		expect( VidDownloads.getInstance().length() ).eq(0)

		const check = await knex<TxRecord>('txs').where({ txid: vid.txid})
		expect(check.length).eq(1)
		expect(check[0].valid_data).true
		expect(check[0].flagged).false

	}).timeout(0)




})