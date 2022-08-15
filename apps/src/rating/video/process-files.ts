import { logger } from '../../utils/logger'
import { FfmpegError, TxRecord } from '../../types'
import { dbCorruptDataConfirmed, dbCorruptDataMaybe } from '../db-update-txs'
import { createScreencaps } from './screencaps'
import { checkFrames } from './check-frames'
import { VidDownloadRecord, VidDownloads } from './VidDownloads'
import { slackLogger } from '../../utils/slackLogger'

/* Video download queue */
const downloads = VidDownloads.getInstance()

export const processVids = async()=> {
	
	/* check if any vids finished downloading & process */

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
				}else if(e.message === 'spawnSync /bin/sh ENOMEM'){
					if(dl.retried === false){
						logger(dl.txid, 'ffmpeg: spawnSync /bin/sh ENOMEM. Will retry once.')
						dl.retried = true
						continue; //skip cleanup()
					}else{
						logger(dl.txid, 'ffmpeg: spawnSync /bin/sh ENOMEM. Already retried. Shelving.')
						dbCorruptDataMaybe(dl.txid)
					}
				}else{
					logger(dl.txid, 'ffmpeg: UNHANDLED error screencaps', e.message)
					slackLogger(dl.txid, 'ffmpeg: UNHANDLED error screencaps', e.message)
					// throw e
				}
				//delete the temp files
				downloads.cleanup(dl)
				continue; //skip to next `dl`
			}

			//let tfjs run through the screencaps & write to db
			if(frames.length < 2){
				logger(dl.txid, 'ERROR: No frames to process!')
				throw new Error(dl.txid + ' No frames to process!')
			}else{ 
				await checkFrames(frames, dl.txid)
			}
			
			//delete the temp files
			downloads.cleanup(dl)
		}
	}
}

