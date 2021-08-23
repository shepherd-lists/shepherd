import { TxRecord } from '../types'
import getDbConnection from '../utils/db-connection'
import { logger } from '../utils/logger'
import { unsupportedTypes, videoTypes, VID_TMPDIR_MAXSIZE } from '../constants'
import { processVids } from './video/process-files'
import { VidDownloads } from './video/VidDownloads'
import { addToDownloads } from './video/downloader'
import col from 'ansi-colors'
import * as ImageRating from './image-rater'
import { performance } from 'perf_hooks'

const prefix = 'queue'
const db = getDbConnection()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const getImages = async()=> {
	const records = await db<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.where( function(){
		this.orWhere({ content_type: 'image/bmp'})
		.orWhere({ content_type: 'image/jpeg'})
		.orWhere({ content_type: 'image/png'})
	})
	.orderBy('last_update_date', 'desc')

	const length = records.length
	logger(prefix, length, 'images found')

	return records
}

const getGifs = async()=> {
	const records = await db<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.where({ content_type: 'image/gif'})
	.orderBy('last_update_date', 'desc')
	
	const length = records.length
	logger(prefix, length, 'gifs found')
	
	return records
}

const getVids = async()=> {
	const records = await db<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.whereIn('content_type', videoTypes)
	.orderBy('last_update_date', 'asc') //'asc' because we pop()

	const length = records.length
	logger(prefix, length, 'videos found')

	return records
}

const getOthers = async()=> {

	//unsupported image types
	const otherImages = await db<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.whereIn('content_type', unsupportedTypes)
	.orderBy('last_update_date', 'desc')

	//all the bad txids - partial/corrupt/oversized/timeouts
	const badDatas = await db<TxRecord>('txs')
	.where({valid_data: false}) //potential bad data
	.whereNull('flagged') //not processed
	.orderBy('last_update_date', 'desc')

	logger(prefix, otherImages.length, 'unsupported images.', badDatas.length, '"bad" txids')

	return [
		...otherImages,
		...badDatas,
	] 
}

// sum trues from array of booleans
const trueCount = (results: boolean[]) => results.reduce((acc, curr)=> curr ? ++acc : acc, 0)

export const rater = async()=>{

	/* initialise. load nsfw tf model */

	await ImageRating.init()
	
	/* get backlog queues */

	const BATCH_IMAGE = 50
	const BATCH_GIF = 5
	const BATCH_VIDEO = 1
	const BATCH_OTHER = 1

	let imageQueue = await getImages()
	let gifQueue = await getGifs()
	let vidQueue = await getVids()
	let otherQueue = await getOthers()

	const vidDownloads = VidDownloads.getInstance()

	/* loop through each queue interleaving one batch at a time */
	
	while(true){

		//splice off a batch from the queue
		let images = imageQueue.splice(0, Math.min(imageQueue.length, BATCH_IMAGE))
		let gifs = gifQueue.splice(0, Math.min(gifQueue.length, BATCH_GIF))
		let others = otherQueue.splice(0, Math.min(otherQueue.length, BATCH_OTHER))

		const imagesBacklog = images.length + gifs.length // + others.length

		if(imagesBacklog !== 0){
			//process a batch of images
			logger(prefix, `processing ${images.length} images of ${imageQueue.length + images.length}`)
			const imgRet: boolean[] = await Promise.all(images.map(image => ImageRating.checkImageTxid(image.txid, image.content_type)))
			logger(prefix, `processed ${trueCount(imgRet)} out of ${images.length} images successfully`)
			
			//process a batch of gifs
			logger(prefix, `processing ${gifs.length} gifs of ${gifQueue.length + gifs.length}`)
			await Promise.all(gifs.map(gif => ImageRating.checkImageTxid(gif.txid, gif.content_type)))
			
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

		const t0 = performance.now()
		//refresh the queues on every single loop to keep current even with a backlog
		imageQueue = await getImages()
		gifQueue = await getGifs()
		if(otherQueue.length === 0) otherQueue = await getOthers()
		vidQueue = await getVids()
		const t1 = performance.now()
		logger(prefix, 'sql queries took', (t1-t0).toFixed(2), 'ms to complete')

		//make sure we're not reloading inflight up vids
		const inflight = vidDownloads.listIds()
		while((vidQueue.length > 0) && inflight.includes(vidQueue[vidQueue.length-1].id)){
			vidQueue.pop()
		}
	}
}