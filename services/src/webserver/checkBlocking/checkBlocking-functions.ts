/**
 * objectives:
 * - check that IPs in lists are correctly blocking data after it is flagged.
 * - also run the resource intensive rangelist dertivations so that they do not 
 * 	 build up and crash the system.
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


const prefix = 'check-blocked'

const hour_ms = 60 * 60 * 1000


/* load the IP access lists */

// pop off first IP. this should always be a test IP
const accessBlacklist: string[] = JSON.parse(process.env.BLACKLIST_ALLOWED || '[]')
accessBlacklist.shift() // pop off first IP. this should always be a test IP
logger(prefix, `accessBlacklist (BLACKLIST_ALLOWED)`, accessBlacklist)

// pop off first IP. this should always be a test IP
const accessRangelist: string[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
accessRangelist.shift() // pop off first IP. this should always be a test IP
logger(prefix, `accessRangelist (RANGELIST_ALLOWED)`, accessRangelist)
const rangeIPs: { ip: string, lastResponse: number}[] = accessRangelist.map(ip => {return {
	ip,
	lastResponse: Date.now()
}})

const gwUrls: string[] = JSON.parse(process.env.GW_URLS || '[]')
logger(prefix, `gwUrls`, gwUrls)

/* module level vars for caching */
let _lastBlack: string[] = []
let _lastRange: string[] = []

export const streamLists = async () => {

	/* check all blacklist txids against GWs */

	if (gwUrls.length === 0) {
		logger(prefix, `gwUrls empty`)
	} else {
		// we're reusing the server's streaming function
		const rwBlack = new PassThrough()

		getBlacklist(rwBlack).then(() => rwBlack.end())

		const txids = readline.createInterface(rwBlack)
		for await (const txid of txids) {
			(process.env.NODE_ENV === 'test') && console.log(`readline txid`, txid)

			//TODO: be smarter later and not recheck txids confirmed as blocked

			gwUrls.forEach(async gw => {
				try{
					await checkBlocked(`${gw}/${txid}`, txid)
				}catch(e:any){
					logger(prefix, `gateway ${gw} is unresponsive! while fetching ${gw}/${txid}`, txid)
					slackLogger(prefix, `gateway ${gw} is unresponsive! while fetching ${gw}/${txid}`, txid)
				}
			})
		}
		rwBlack.destroy(); txids.close();
	}

	/* check all ranges against nodes (and GWs too?) */

	if (gwUrls.length === 0 && rangeIPs.length === 0) {
		logger(prefix, `gwUrls & accessRangelist empty`, `running getRangelist to prevent backlog`)

		/* need to run this once in a while to prevent backlog */

		const rwRange = new PassThrough()
		await getRangelist(rwRange)
		rwRange.end()
		rwRange.destroy();
	} else {
		const rwRange = new PassThrough()
		getRangelist(rwRange).then(() => rwRange.end())

		const ranges = readline.createInterface(rwRange)
		for await (const range of ranges) {
			(process.env.NODE_ENV === 'test') && console.log(`readline range`, range)

			const [range1, range2] = range.split(',')

			gwUrls.forEach(async gw => {
				try{
					await checkBlocked(`${gw}/chunk/${+range1 + 1}`, range)
				}catch(e:any){
					logger(prefix, `gateway ${gw} is unresponsive! while fetching ${gw}/chunk/${+range1 + 1}`, range)
					slackLogger(prefix, `gateway ${gw} is unresponsive! while fetching ${gw}/chunk/${+range1 + 1}`, range)
				}
			})
			rangeIPs.forEach(async rangeIp => {
				try{
					await checkBlocked(`http://${rangeIp.ip}:1984/chunk/${+range1 + 1}`, range)
					rangeIp.lastResponse = Date.now()
				}catch(e:any){
					// logger(prefix, `${e.name} : ${e.message}`)
					const now = Date.now()
					if(now - rangeIp.lastResponse > hour_ms){
						logger(prefix, `node '${rangeIp.ip}' is unresponsive for the last hour`)
						slackLogger(prefix, `node '${rangeIp.ip}' is unresponsive for the last hour`)
						rangeIp.lastResponse = Date.now() //reset message timer for another hour
					}
				}
			})
		}
		rwRange.destroy(); ranges.close();
	}
}

export const checkBlocked = async (url: string, item: string) => {
	const { aborter, res: { status, headers } } = await fetch_checkBlocking(url)
	
	if (status !== 404) {
		logger(prefix, `WARNING! ${item} not blocked on ${url} (status: ${status}), xtrace: '${headers.get('x-trace')}', age: '${headers.get('age')}', content-length: '${headers.get('content-length')}'`)

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
	}

	aborter?.abort() 
}

