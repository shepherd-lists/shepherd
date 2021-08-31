import fs from 'fs'
import { HOST_URL } from '../../constants'
import { logger } from '../../utils/logger'
import * as FilterHost from "../filter-host"
import { updateDb } from '../db-update-txs'


const prefix = 'check-frames'

export const checkFrames = async(frames: string[], txid: string)=> {
	const videopath = frames.shift()
	if(frames.length === 0) throw new Error(txid + ' Error: no frames to check')

	const vidUrl = HOST_URL + '/' + videopath!.split('/').pop()

	let flagged = false

	//TODO: change this NsfwjsPlugin specific scores code later
	let scores: {nsfw_hentai?: number, nsfw_porn?: number, nsfw_sexy?: number, nsfw_neutral?: number, nsfw_drawings?: number } = {}
	
	//loop through caps. break if flagged image found
	for (const frame of frames) {
		const pic = fs.readFileSync(frame)
		const result = await FilterHost.checkImage(pic, 'image/png', txid)

		if(result.flagged !== undefined && result.flagged === true){
			flagged = true

			//TODO: remove this NsfwjsPlugin specific code later
			if(result.scores){
				let s = JSON.parse(result.scores)
				// some rough type checking
				if('nsfw_hentai' in s || 'nsfw_porn' in s || 'nsfw_sexy' in s || 'nsfw_neutral' in s || 'nsfw_drawings' in s ){
					scores = s
				}
			}//EO code to remove

			break;
		}
	}
	if(!flagged){ 
		logger(txid, 'video clean', vidUrl)
	}else{
		logger(txid, 'video flagged', scores, vidUrl)
	}

	return updateDb(txid,{
		flagged,
		valid_data: true,
		...(true && scores), //use some spread trickery to add non-null (or zero value) keys
		last_update_date: new Date(),
	})
}




