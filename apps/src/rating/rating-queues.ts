import { TxRecord } from '../types'
import getDbConnection from '../utils/db-connection'
import { logger } from '../utils/logger'
import { unsupportedTypes, videoTypes, VID_TMPDIR_MAXSIZE } from '../constants'
import { processVids } from './video/process-files'
import { VidDownloads } from './video/VidDownloads'
import { addToDownloads } from './video/downloader'
import { performance } from 'perf_hooks'
import * as FilterHost from './filter-host'

const prefix = 'queue'
const knex = getDbConnection()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const getImages = async(batch: number)=> {
	const records = await knex<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.where('content_type', 'like', 'image%')
	.whereNotIn('id', knex.select('foreign_id').from('inflights'))
	.orderBy('id', 'desc')
	.limit(batch)

	const length = records.length
	logger(prefix, length, 'images selected. batch size', batch)

	return records
}

// const getGifs = async(batch: number)=> {
// 	const records = await knex<TxRecord>('txs')
// 	.whereNull('valid_data') //not processed yet
// 	.where({ content_type: 'image/gif'})
// 	.whereNotIn('id', knex.select('foreign_id').from('inflights'))
// 	.orderBy('id', 'desc')
// 	.limit(batch)
	
// 	const length = records.length
// 	logger(prefix, length, 'gifs selected. batch size', batch)
	
// 	return records
// }

// const getVids = async(batch: number)=> {
// 	const records = await knex<TxRecord>('txs')
// 	.whereNull('valid_data') //not processed yet
// 	.whereIn('content_type', videoTypes)
// 	.orderBy('last_update_date', 'asc') //'asc' because we pop()
// 	.limit(batch)

// 	const length = records.length
// 	logger(prefix, length, 'videos selected. batch size', batch)

// 	return records
// }

// const getOthers = async(batch: number)=> {
// 	//unsupported image types
// 	const otherImages = await knex<TxRecord>('txs')
// 	.whereNull('valid_data') //not processed yet
// 	.whereIn('content_type', unsupportedTypes)
// 	.orderBy('last_update_date', 'desc')
// 	.limit(batch)

// 	//all the bad txids - partial/corrupt/oversized/timeouts
// 	const badDatas = await knex<TxRecord>('txs')
// 	.where({valid_data: false}) //potential bad data
// 	.whereNull('flagged') //not processed
// 	.orderBy('last_update_date', 'desc')
// 	.limit(batch)

// 	logger(prefix, otherImages.length, 'unsupported images.', badDatas.length, '"bad" txids')

// 	return [
// 		...otherImages,
// 		...badDatas,
// 	] 
// }

// sum trues from array of booleans
const trueCount = (results: boolean[]) => results.reduce((acc, curr)=> curr ? ++acc : acc, 0)

export const rater = async(lowmem: boolean)=>{

	/* get backlog queues */
	const NUM_TASKS = 3
	const WORKING_RECORDS = 100000 * NUM_TASKS

	const BATCH_IMAGE = lowmem? 5 : 50 * NUM_TASKS
	const BATCH_GIF = lowmem? 1 : 2 * NUM_TASKS
	const BATCH_VIDEO = 11
	const BATCH_OTHER = 1 
	const TASK_ID = Number(process.env.TASK_ID) //individual
	console.log('TASK_ID', TASK_ID)

	let imageQueue = await getImages(WORKING_RECORDS)
	// let gifQueue =await getGifs(BATCH_GIF)
	let vidQueue: TxRecord[] = [] //await getVids(BATCH_VIDEO)
	let otherQueue: TxRecord[] = [] //await getOthers(BATCH_OTHER)

	const vidDownloads = VidDownloads.getInstance()

	/* loop through each queue interleaving one batch at a time */
	
	while(true){
		const t0 = performance.now()

		//splice off a batch from the queue
		let images = imageQueue.splice(0, Math.min(imageQueue.length, BATCH_IMAGE))
		images = images.filter(rec=> (+rec.id % NUM_TASKS === TASK_ID) )
		// let gifs = gifQueue.splice(0, Math.min(gifQueue.length, BATCH_GIF))
		// gifs = gifs.filter(rec=> (+rec.id % NUM_TASKS === TASK_ID) )
		// let others = otherQueue.splice(0, Math.min(otherQueue.length, BATCH_OTHER))

		const imagesBacklog = images.length //+ gifs.length // + others.length

		if(imagesBacklog !== 0){
			//process a batch of images
			logger(prefix, `processing ${images.length} images of ${imageQueue.length + images.length}`)
			const imgRet: boolean[] = await Promise.all(images.map(image => FilterHost.checkImageTxid(image.txid, image.content_type)))
			logger(prefix, `processed ${trueCount(imgRet)} out of ${images.length} images successfully`)
			
			// //process a batch of gifs
			// logger(prefix, `processing ${gifs.length} gifs of ${gifQueue.length + gifs.length}`)
			// await Promise.all(gifs.map(gif => FilterHost.checkImageTxid(gif.txid, gif.content_type)))
			
			// //process a batch of others
			// logger(prefix, `processing ${others.length} others of ${otherQueue.length + others.length}`)
			// //TODO: await Promise.all(others.map(other => checkOtherTxid(other)))
		}
		
		//start another video download
		if((vidQueue.length > 0) && (vidDownloads.length() < 10) && (vidDownloads.size() < VID_TMPDIR_MAXSIZE)){
			logger(prefix, `downloading one from ${vidQueue.length} videos`)
			let vid = vidQueue.pop() as TxRecord
			await addToDownloads(vid)
		}
		//process downloaded videos
		if(vidDownloads.length() > 0){
			await processVids()
			//cleanup aborted/errored downloads
			for (const dl of vidDownloads) {
				if(dl.complete === 'ERROR'){
					vidDownloads.cleanup(dl)
				}
			}
		}

		if((imagesBacklog + vidQueue.length + vidDownloads.length()) === 0){
			//all queues are empty so wait 30 seconds
			logger(prefix, 'all rating queues at zero length')
			await sleep(30000)
		}else if(
			imagesBacklog === 0 
			&& vidDownloads.length() > 0
			&& (vidDownloads.length() === 10 || vidQueue.length === 0)
		){
			logger(prefix, 'videos downloading...')
			await sleep(5000)
		}

		
		//refresh the queues only when WORKING_RECORDS are empty
		if(imageQueue.length === 0) imageQueue = await getImages(WORKING_RECORDS)
		// gifQueue = await getGifs(BATCH_GIF)
		if(otherQueue.length === 0) otherQueue = [] //await getOthers(BATCH_OTHER)
		vidQueue = []//await getVids(BATCH_VIDEO)
		

		//make sure we're not reloading inflight vids
		const inflight = vidDownloads.listIds()
		while((vidQueue.length > 0) && inflight.includes(vidQueue[vidQueue.length-1].id)){
			vidQueue.pop()
		}
		
		const t1 = performance.now()
		logger(prefix, '1 loop took', (t1-t0).toFixed(2), 'ms to complete')
	}
}