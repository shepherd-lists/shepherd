import { TxRecord } from '../common/types'
import getDbConnection from '../common/utils/db-connection'
import { logger } from '../common/utils/logger'
import { unsupportedTypes, videoTypes, VID_TMPDIR_MAXSIZE } from '../common/constants'
import { processVids } from './video/process-files'
import { VidDownloads } from './video/VidDownloads'
import { addToDownloads } from './video/downloader'
import { performance } from 'perf_hooks'
import * as FilterHost from './filter-host'

const prefix = 'queue'
const db = getDbConnection()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const getImages = async(batch: number)=> {
	const records = await db<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.where( function(){
		this.orWhere({ content_type: 'image/bmp'})
		.orWhere({ content_type: 'image/jpeg'})
		.orWhere({ content_type: 'image/png'})
	})
	.orderBy('last_update_date', 'desc')
	.limit(batch)

	const length = records.length
	logger(prefix, length, 'images selected. batch size', batch)

	return records
}

const getGifs = async(batch: number)=> {
	const records = await db<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.where({ content_type: 'image/gif'})
	.orderBy('last_update_date', 'desc')
	.limit(batch)
	
	const length = records.length
	logger(prefix, length, 'gifs selected. batch size', batch)
	
	return records
}

const getVids = async(batch: number)=> {
	const records = await db<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.whereIn('content_type', videoTypes)
	.orderBy('last_update_date', 'desc') //'asc' because we pop()
	.limit(batch)

	const length = records.length
	logger(prefix, length, 'videos selected. batch size', batch)

	return records
}

const getOthers = async(batch: number)=> {

	//unsupported image types
	const otherImages = await db<TxRecord>('txs')
	.whereNull('valid_data') //not processed yet
	.whereIn('content_type', unsupportedTypes)
	.orderBy('last_update_date', 'desc')
	.limit(batch)

	//all the bad txids - partial/corrupt/oversized/timeouts
	const badDatas = await db<TxRecord>('txs')
	.where({valid_data: false}) //potential bad data
	.whereNull('flagged') //not processed
	.orderBy('last_update_date', 'desc')
	.limit(batch)

	logger(prefix, otherImages.length, 'unsupported images.', badDatas.length, '"bad" txids')

	return [
		...otherImages,
		...badDatas,
	] 
}

// sum trues from array of booleans
const trueCount = (results: boolean[]) => results.reduce((acc, curr)=> curr ? ++acc : acc, 0)

export const rater = async(lowmem: boolean)=>{

	/* get backlog queues */

	const BATCH_IMAGE = lowmem? 5 : 50
	const BATCH_GIF = lowmem? 1 : 1
	const BATCH_VIDEO = 11
	const BATCH_OTHER = 1

	let imageQueue = await getImages(BATCH_IMAGE)
	let gifQueue = await getGifs(BATCH_GIF)
	let vidQueue: TxRecord[] = await getVids(BATCH_VIDEO)
	let otherQueue = [] as TxRecord[]//await getOthers(BATCH_OTHER)

	const vidDownloads = VidDownloads.getInstance()

	/* loop through each queue interleaving one batch at a time */
	
	while(true){

		//splice off a batch from the queue
		let images = imageQueue.splice(0, Math.min(imageQueue.length, BATCH_IMAGE))
		let gifs = gifQueue.splice(0, Math.min(gifQueue.length, BATCH_GIF))
		let others = [] as TxRecord[]//otherQueue.splice(0, Math.min(otherQueue.length, BATCH_OTHER))

		const imagesBacklog = images.length + gifs.length // + others.length

		if(imagesBacklog !== 0){
			//process a batch of images
			logger(prefix, `processing ${images.length} images of ${imageQueue.length + images.length}`)
			const imgRet: boolean[] = await Promise.all(images.map(image => FilterHost.checkImageTxid(image.txid, image.content_type)))
			logger(prefix, `processed ${trueCount(imgRet)} out of ${images.length} images successfully`)
			
			//process a batch of gifs
			logger(prefix, `processing ${gifs.length} gifs of ${gifQueue.length + gifs.length}`)
			await Promise.all(gifs.map(gif => FilterHost.checkImageTxid(gif.txid, gif.content_type)))
			
			// //process a batch of others
			// logger(prefix, `processing ${others.length} others of ${otherQueue.length + others.length}`)
			// //TODO: await Promise.all(others.map(other => checkOtherTxid(other)))
		}
		
		//start another video download
		if((vidQueue.length > 0) && (vidDownloads.length() < 10) && (vidDownloads.size() < VID_TMPDIR_MAXSIZE)){
			const numToAdd = 10 - vidDownloads.length() 
			logger(prefix, `downloading ${numToAdd} from ${vidQueue.length} videos`)
			for(let i = 0; i < numToAdd; i++) {
				await addToDownloads( vidQueue.pop() as TxRecord )
			}
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
			logger(prefix, `${vidDownloads.length()} videos, ${(vidDownloads.size()/1048576).toLocaleString()} MBs downloading...`)
			console.log(vidDownloads.listIds())
			await sleep(5000)
		}

		const t0 = performance.now()
		//refresh the queues on every single loop to keep current even with a backlog
		imageQueue = await getImages(BATCH_IMAGE)
		gifQueue = await getGifs(BATCH_GIF)
		if(otherQueue.length === 0) { ; }//otherQueue = await getOthers(BATCH_OTHER)
		vidQueue = await getVids(BATCH_VIDEO)
		const t1 = performance.now()
		logger(prefix, 'sql queries took', (t1-t0).toFixed(2), 'ms to complete')

		//make sure we're not reloading inflight vids
		const inflight = vidDownloads.listIds()
		console.log({inflight})
		vidQueue = vidQueue.filter(item => !inflight.includes(item.id))
	}
}