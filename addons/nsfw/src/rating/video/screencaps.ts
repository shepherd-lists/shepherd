import { VID_TMPDIR } from '../../constants'
import { logger } from '../../utils/logger'
import { execSync } from 'child_process'
import shelljs from 'shelljs'
import { FfmpegError } from 'shepherd-plugin-interfaces/types'
import { EOL } from 'os'


export const createScreencaps = async(txid: string)=> {
	try{
		const folderpath = VID_TMPDIR + txid + '/'
		/**
		 * TODO: Perhaps skipping the first second of video makes sense - depending on the length of video of course - I am thinking fade-ins
		 * - check video duration <= requires extra initial call to ffmpeg or ffprobe
		 * - regex the duration from the output
		 * - conditionally add option "-ss 00:00:01" if video longer than 2 seconds?
		 */
		const command = `ffmpeg -i ${folderpath}${txid} -r 1/6 ${folderpath}${txid}-%03d.png`
		/* debug*/ console.log(createScreencaps.name, command)
		execSync(command,{ stdio: 'pipe', maxBuffer: 200*1024*1024 })

		const list = shelljs.ls(folderpath)
		const frames: string[] = []
		for(const fname of list){
			frames.push(folderpath + fname)
		}

		if(process.env.NODE_ENV === 'test'){
			logger(txid, command)
			logger(txid, frames)
		}
		logger(txid, 'number of screencaps:', (frames.length - 1))

		return frames

	}catch(error: unknown){
		const e = error as Error & { status: number}
		/* this covers most cases */
		const errMsg: string = e.message.split(':').pop()!.trim()
		const err: FfmpegError = { name: 'FfmpegError', message: errMsg, status: e.status }

		/* throw specific known cases */
		if(
			[
				'Invalid data found when processing input',
				'No such file or directory', //should not happen!
				'Output file #0 does not contain any stream', //no video stream
				'spawnSync /bin/sh ENOMEM', //try again later
			].includes(errMsg)
		){
			throw err
		}else{
			logger(txid, 'possibly not throwing:', errMsg)
		}

		// /* give correct error when there is no video stream in the file */
		// const hasVideoStream = (e.message as string).match(/Stream #([0-9\:]+)([a-z0-9\(\)\[\]]*): Video/g) ? true : false
		// if(!hasVideoStream){
		// 	err.message = 'no video stream'
		// 	throw err
		// }

		/* get a better error mesage in certain cases */
		const errMsgLines = errMsg.split(EOL)
		if(errMsgLines.length > 0){
			err.message = 'ffout[1]:' + errMsgLines[1]
			throw err
		}
		throw err
	}
}



