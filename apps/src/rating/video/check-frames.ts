import fs from 'fs'
import { HOST_URL } from '../../constants'
import { logger } from '../../utils/logger'
import * as FilterHost from "../filter-host"
import { updateTxsDb } from '../db-update-txs'


const prefix = 'check-frames'

export const checkFrames = async(frames: string[], txid: string)=> {
	const videopath = frames.shift()
	if(frames.length === 0) throw new Error(txid + ' Error: no frames to check')

	const vidUrl = HOST_URL + '/' + videopath!.split('/').pop()

	let flagged = false
	
	//loop through caps. break if flagged image found
	for (const frame of frames) {
		const pic = fs.readFileSync(frame)
		const result = await FilterHost.checkImage(pic, 'image/png', txid)

		if(result.flagged !== undefined && result.flagged === true){
			flagged = true
			break;
		}
	}
	logger(txid, 'video', ((flagged) ? 'flagged' : 'clean'), vidUrl)

	return updateTxsDb(txid,{
		flagged,
		valid_data: true,
		last_update_date: new Date(),
	})
}




