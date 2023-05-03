import fs from 'fs'
import { logger } from '../../utils/logger'
import * as FilterHost from "../filter-host"
import { updateTx } from '../../utils/update-txs'


const prefix = 'check-frames'

const HOST_URL = process.env.HOST_URL!

export const checkFrames = async(frames: string[], txid: string)=> {
	const videopath = frames.shift()
	/* debug */ console.log(checkFrames.name, {frames})
	if(frames.length === 0) throw new Error(txid + ' Error: no frames to check')

	const vidUrl = HOST_URL + '/' + videopath!.split('/').pop()

	let flagged = false
	let top_score_name, top_score_value
	
	//loop through caps. break if flagged image found
	for (const frame of frames) {
		const pic = fs.readFileSync(frame)
		const result = await FilterHost.checkImage(pic, 'image/png', txid)

		if(result.flagged !== undefined && result.flagged === true){
			flagged = true
			top_score_name = result.top_score_name
			top_score_value = result.top_score_value
			break;
		}
	}
	logger(txid, 'video', ((flagged) ? 'flagged' : 'clean'), vidUrl)

	const res = await updateTx(txid,{
		flagged,
		...( top_score_name && { 
			top_score_name, 
			top_score_value,
		}),
	})
	
	return res;
}




