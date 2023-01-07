import { logger } from '../../utils/logger'
import { FfmpegError, } from 'shepherd-plugin-interfaces/types'
import { dbCorruptDataConfirmed, dbCorruptDataMaybe } from '../../utils/db-update-txs'
import { createScreencaps } from './screencaps'
import { checkFrames } from './check-frames'
import { VidDownloads } from './VidDownloads'
import { slackLogger } from '../../utils/slackLogger'

/* Video download queue */
const downloads = VidDownloads.getInstance()

export const processVids = async()=> {
	
	/* check if any vids finished downloading & process */

	// /* debug */ const items = []
	// /* debug */ for (const item of downloads) items.push(item)
	// /* debug */ console.log(processVids.name, { items })

	for (const dl of downloads) {
		if(dl.complete === 'TRUE'){
			dl.complete = 'FALSE' //stop processing from beginning again
			logger(dl.txid, 'begin processing')
			
			//create screencaps & handle errors
			let frames: string[] = []
			try{

				frames = await createScreencaps(dl.txid)

			}catch(err: any){
				const e: FfmpegError = err
				if(e.message === 'Output file #0 does not contain any stream'){
					logger(dl.txid, 'ffmpeg: Output file #0 does not contain any stream')
					dbCorruptDataConfirmed(dl.txid)
					downloads.cleanup(dl)
					continue; //dont checkFrames
				}else if(e.message === 'No such file or directory'){
					//we should not be in createScreencaps if there is no video file
					throw e
				}else if(
					[
						'Invalid data found when processing input',
						'ffout[1]:Error opening filters!',
						'ffout[1]:undefined',
						'ffout[1]:Conversion failed!',
					].includes(e.message)
				){
					logger(dl.txid, 'ffmpeg: corrupt maybe:', e.message)
					dbCorruptDataMaybe(dl.txid)
					downloads.cleanup(dl)
					continue; //dont checkFrames
				}else if(
					[
						'spawnSync /bin/sh ENOMEM', 
						'ffout[1]:Error marking filters as finished',
					].includes(e.message)
				){
					/**
					 * using local retry on these errors is causing transactions to completely fill up the 
					 * internal queues. better to retry using the SQS queues.
					 */
					logger(dl.txid, `${e.name}:${e.message}. Cleaning up and releasing back to SQS queue.`)
					downloads.cleanup(dl)
					continue; //dont checkFrames
				}else{
					logger(dl.txid, 'ffmpeg: UNHANDLED error screencaps', e.message)
					slackLogger(dl.txid, 'ffmpeg: UNHANDLED error screencaps', e.message)
					// throw e
				}
				//delete the temp files
				downloads.cleanup(dl)
			}

			//let tfjs run through the screencaps & write to db
			if(frames.length < 2){
				logger(dl.txid, 'ERROR: NO FRAMES TO PROCESS!')
				slackLogger(dl.txid, ' No frames to process!')
			}else{ 
				await checkFrames(frames, dl.txid)
			}
			
			//delete the temp files
			downloads.cleanup(dl)
		}
	}
}

