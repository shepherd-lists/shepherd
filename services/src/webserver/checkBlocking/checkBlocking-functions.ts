/**
 * objectives:
 * - check that IPs in lists are correctly blocking data after it is flagged.
 * 
 * this file separates out the functions for test.
 */
import { PassThrough } from "stream";
import readline from 'readline'
import { logger } from "../../common/shepherd-plugin-interfaces/logger";
import { slackLogger } from "../../common/utils/slackLogger";
import { slackLoggerPositive } from "../../common/utils/slackLoggerPositive";
import { getBlacklist, getRangelist } from "../blacklist";
import { fetch_checkBlocking } from "./fetch-checkBlocking";
import { LogEvent } from './log-event-type'
import { deleteUnreachable, isUnreachable, setAlertState, setUnreachable, unreachableTimedout } from "./event-tracking";


const prefix = 'check-blocked'

const hour_ms = 60 * 60 * 1000


/* load the IP access lists */

// pop off first IP. this should always be a test IP
const rangeIPs: string[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
// accessRangelist.shift() // pop off first IP. this should always be a test IP
logger(prefix, `accessRangelist (RANGELIST_ALLOWED)`, rangeIPs)

const gwUrls: string[] = JSON.parse(process.env.GW_URLS || '[]')
logger(prefix, `gwUrls`, gwUrls)

let _running = false
export const checkBlockedCronjob = async () => {

	logger(prefix, `starting ${checkBlockedCronjob.name}() cronjob...`, { rangeIPs, gwUrls, _running })
	if (_running) {
		logger(prefix, `${checkBlockedCronjob.name}() already running. exiting...`)
		return;
	}
	_running = true


	try {
		
		/* check all blacklist txids against GWs */
	
		if (gwUrls.length === 0) {
			logger(prefix, `gwUrls empty. nothing to check txids against.`)
		} else {
			// we're reusing the server's streaming function
			const rwBlack = new PassThrough()
	
			getBlacklist(rwBlack).then(() => rwBlack.end())
	
			const txids = readline.createInterface(rwBlack)
			for await (const txid of txids) {
				(process.env.NODE_ENV === 'test') && console.log(`readline txid`, txid)
	
				await Promise.all(gwUrls.map(async gw => {
					try{
						if(!isUnreachable(gw) || unreachableTimedout(gw)){
							await checkBlocked(`${gw}/${txid}`, txid, gw)
							//if didn't throw error, then it's reachable
							deleteUnreachable(gw)
						}
					}catch(e:any){
						setUnreachable(gw)
						logger(prefix, `gateway ${gw} is unreachable! while fetching ${gw}/${txid}`, txid)
						slackLogger(prefix, `gateway ${gw} is unreachable! while fetching ${gw}/${txid}`, txid)
					}
				}))
			}
			rwBlack.destroy(); txids.close();
		}
	
		/* check all ranges against nodes (and GWs too?) */
	
		if (gwUrls.length === 0 && rangeIPs.length === 0) {
			logger(prefix, `gwUrls & accessRangelist empty. nothing to check byteranges against.`)
	
		} else {
			const rwRange = new PassThrough()
			getRangelist(rwRange).then(() => rwRange.end())	//byte-range already calculated
	
			const ranges = readline.createInterface(rwRange)
			for await (const range of ranges) {
				(process.env.NODE_ENV === 'test') && console.log(`readline range`, range)
	
				const [range1, range2] = range.split(',')
	
				await Promise.all(gwUrls.map(async gw => {
					try{
						if(!isUnreachable(gw) || unreachableTimedout(gw)){
							await checkBlocked(`${gw}/chunk/${+range1 + 1}`, range, gw)
							//if didn't throw error, then it's reachable
							deleteUnreachable(gw)
						}
					}catch(e:any){
						setUnreachable(gw)
						logger(prefix, `gateway ${gw} is unreachable! while fetching ${gw}/chunk/${+range1 + 1}`, range)
						slackLogger(prefix, `gateway ${gw} is unreachable! while fetching ${gw}/chunk/${+range1 + 1}`, range)
					}
				}))
				await Promise.all(rangeIPs.map(async rangeIp => {
					try{
						if(!isUnreachable(rangeIp) || unreachableTimedout(rangeIp)){
							await checkBlocked(`http://${rangeIp}:1984/chunk/${+range1 + 1}`, range, rangeIp)
							//if didn't throw error, then it's reachable
							deleteUnreachable(rangeIp)
						}
					}catch(e:any){
						setUnreachable(rangeIp)
						logger(prefix, `set '${rangeIp}' as unreachable, while fetching http://${rangeIp}:1984/chunk/${+range1 + 1}`)
					}
				}))
			}
			rwRange.destroy(); ranges.close();
		}
	}finally{
		_running = false
	}
}


export const checkBlocked = async (url: string, item: string, server: string) => {
	let response: { res: Response, aborter?: AbortController } | undefined = undefined
	try {
		response = await fetch_checkBlocking(url)
		const { res: { status, headers } } = response
		
		if(status >= 500){
			logger(prefix, `server ${server} returned ${status} for ${url}. Skipping...`)
			return;
		}
		if(status !== 404){
			/** for aws notifications (not working too well) */
			const logevent: LogEvent = {
				eventType: 'not-blocked',
				url,
				item,
				server,
				status,
				xtrace: headers.get('x-trace'),
				age: headers.get('age'),
				contentLength: headers.get('content-length'),
			}
			logger(logevent)

			/** send event to homebrew event tracker */
			setAlertState({
				server,
				item,
				status: 'alarm',
				details: {
					xtrace: headers.get('x-trace') || 'null',
					age: headers.get('age') || 'null',
					contentLength: headers.get('content-length') || 'null',
					httpStatus: status,
					endpointType: item.length === 43 ? '/TXID' : '/chunk',
				},
			})

			/* make sure Slack doesn't display link contents */
			
			let nodisplay = url.split('/')
			let display = url
			if(nodisplay.length === 4){
				nodisplay.pop()
				display = nodisplay.join('/')
			} 
			slackLoggerPositive('warning', `[${prefix}] ${item} not blocked on \`${display}\` (status: ${status}), xtrace: '${headers.get('x-trace')}', age: '${headers.get('age')}', content-length: '${headers.get('content-length')}'`)
		}else{
			logger(prefix, `OK. ${item} blocked on ${url} (status:${status})`)
			setAlertState({ server, item, status: 'ok' })
		}
	}finally{
		response?.aborter?.abort()
	}

}

