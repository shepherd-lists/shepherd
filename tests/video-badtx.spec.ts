require('dotenv').config() //first line of entrypoint
process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import { createScreencaps } from '../src/rating/video/screencaps'
import { addToDownloads, videoDownload } from '../src/rating/video/downloader'
import col from 'ansi-colors'
import { VidDownloadRecord } from '../src/rating/video/VidDownloads'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('video bad tx handling tests', ()=> {

	it('7mRWvWP5KPoDfmpbGYILChc9bjjXpiPhxuhXwlnODik: ffmpeg found corrupt data', async()=>{
		//@ts-ignore
		const badData: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: 262144,
			txid: '7mRWvWP5KPoDfmpbGYILChc9bjjXpiPhxuhXwlnODik', // corrupt video data
		}
		try{
			const res = await videoDownload(badData)
			while(badData.complete === 'FALSE'){ await sleep(500) }
			if(badData.complete === 'ERROR') throw new Error(badData.txid + ' download failed')
			//we're expecting an ffmpeg error in createScreencaps
			const frames = await createScreencaps(badData.txid) 
			expect(true).false //err if we get here 
		}catch(e){
			expect(e.message).eq('Invalid data found when processing input')
		}
	}).timeout(0)

	it('u54MK6zX3B0hjRqQqGzHn1m7ZGCsHNTWvFOrc0oBbCQ: expect `no video stream` error', async()=>{
		//@ts-ignore
		const badData: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: 262144,
			txid: 'u54MK6zX3B0hjRqQqGzHn1m7ZGCsHNTWvFOrc0oBbCQ', // audio only
		}
		try{
			const res = await videoDownload(badData)
			while(badData.complete === 'FALSE'){ await sleep(500) }
			if(badData.complete === 'ERROR') throw new Error(badData.txid + ' download failed')
			//we're expecting an ffmpeg error in createScreencaps
			const frames = await createScreencaps(badData.txid)
			expect(true).false //err if we get here 
		}catch(e){
			expect(e.message).eq('no video stream')
		}
	}).timeout(0)
	
	it('SxP57BAAiZB0WEipA0_LtyQJ0SY51DwI4vE4N03ykJ0: expect error 404', async()=>{
		//@ts-ignore
		const badData: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: 0,
			txid: 'SxP57BAAiZB0WEipA0_LtyQJ0SY51DwI4vE4N03ykJ0', // error 404
		}
		//this does not throw an error, just gets handled.
		const res = await videoDownload(badData)
		expect(res).eq(404)
		expect(badData.complete).eq('ERROR')
	}).timeout(0)


})