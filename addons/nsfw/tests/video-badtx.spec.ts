require('dotenv').config() //first line of entrypoint
process.env['NODE_ENV'] = 'test'
import { expect } from 'chai'
import { createScreencaps } from '../src/rating/video/screencaps'
import { videoDownload } from '../src/rating/video/downloader'
import { VidDownloadRecord } from '../src/rating/video/VidDownloads'
import dbConnection from '../src/utils/db-connection'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { S3 } from "aws-sdk";
import { readFileSync } from 'fs'

const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.SQS_LOCAL==='yes' && { 
		endpoint: process.env.S3_LOCAL_ENDPOINT!, 
		region: 'dummy-value',
		s3ForcePathStyle: true, // *** needed with minio ***
	}),
	maxRetries: 10,
})
const s3Upload = async (txid:string) => s3.upload({
	Bucket: 'shepherd-input-mod-local', 
	Key: txid,
	Body: readFileSync(`${__dirname}/`+`./fixtures/${txid}`),
}).promise()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const knex = dbConnection()

describe('video-badtx video bad tx handling tests', ()=> {

	it('7mRWvWP5KPoDfmpbGYILChc9bjjXpiPhxuhXwlnODik: ffmpeg found corrupt data', async()=>{
		//@ts-ignore
		const badData: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: '262144',
			txid: '7mRWvWP5KPoDfmpbGYILChc9bjjXpiPhxuhXwlnODik', // corrupt video data
		}
		await s3Upload(badData.txid)
		try{
			const res = await videoDownload(badData)
			while(badData.complete === 'FALSE'){ await sleep(500) }
			if(badData.complete === 'ERROR') throw new Error(badData.txid + ' download failed')
			//we're expecting an ffmpeg error in createScreencaps
			const frames = await createScreencaps(badData.txid) 
			expect(true).false //err if we get here 
		}catch(e:any){
			expect(e.message).eq('Invalid data found when processing input')
		}
	}).timeout(0)

	it('u54MK6zX3B0hjRqQqGzHn1m7ZGCsHNTWvFOrc0oBbCQ: expect `no video stream` error', async()=>{
		//@ts-ignore
		const badData: VidDownloadRecord = {
			complete: 'FALSE',
			content_size: '262144',
			txid: 'u54MK6zX3B0hjRqQqGzHn1m7ZGCsHNTWvFOrc0oBbCQ', // audio only
		}
		await s3Upload(badData.txid)
		try{
			const res = await videoDownload(badData)
			while(badData.complete === 'FALSE'){ await sleep(500) }
			if(badData.complete === 'ERROR') throw new Error(badData.txid + ' download failed')
			//we're expecting an ffmpeg error in createScreencaps
			const frames = await createScreencaps(badData.txid)
			expect(true).false //err if we get here 
		}catch(e:any){
			expect(e.message).eq('Output file #0 does not contain any stream')
		}
	}).timeout(0)


})