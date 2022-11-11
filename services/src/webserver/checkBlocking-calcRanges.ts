/**
 * objectives:
 * - check that IPs in lists are correctly blocking data after it is flagged.
 * - also run the resource intensive rangelist dertivations so that they do not 
 * 	 build up and crash the system.
 */
import { Readable, PassThrough } from "stream";
import { logger } from "../common/shepherd-plugin-interfaces/logger";
import { slackLogger } from "../common/utils/slackLogger";
import { slackLoggerPositive } from "../common/utils/slackLoggerPositive";
import { getBlacklist } from "./blacklist";
import { fetchRetryConnection } from "./txidToRange/fetch-retry";

const INTERVAL = 1000 * 10 //*60*5 // 5 minutes
const prefix = 'check-blocked'

/**
 * !!!!!!!!!!!!!! REMOVE THESE !!!!!!!!!!!!!!
 */
process.env.BLACKLIST_ALLOWED='["18.133.229.130","18.232.24.99","52.70.33.161","54.89.25.96","35.167.46.23","44.242.134.33"]'
process.env.GW_URLS='["https://arweave.net","https://arweave.dev"]'

/* load the IP access lists */
const accessBlacklist: string[] = JSON.parse(process.env.BLACKLIST_ALLOWED || '[]')
logger(prefix, `accessBlacklist (BLACKLIST_ALLOWED)`, accessBlacklist)
const gwUrls: string[] = JSON.parse(process.env.GW_URLS || '[]')
logger(prefix, `gwUrls`, gwUrls)
const accessRangelist: string[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
console.log(prefix, `accessRangelist (RANGELIST_ALLOWED)`, accessRangelist)
// pop off first IP. this should always be a test IP
accessBlacklist.shift()
accessRangelist.shift()

let _lastBlack = []
let _lastRange = []

setInterval(async()=> {

	/* check all blacklist txids against GWs */
	
	// we're reusing the server's streaming function
	const rwBlack = new PassThrough()
	
	await getBlacklist(rwBlack)  
	rwBlack.end()
	// const rl = readline
	const txids = (await streamToString(rwBlack)).split('\n')
	txids.pop() // eof has newline
	console.log({ txids })
	if(txids.length === _lastBlack.length){
		return console.log(`no new entries, nothing to do`)
	}
	txids.forEach(txid => gwUrls.forEach(async gw => {
		const { aborter, res: {status} } = await fetchRetryConnection(`${gw}/${txid}`)
		aborter?.abort()
		if(status !== 404){
			logger(prefix, `WARNING! ${txid} not blocked on ${gw} (status: ${status})`)
			slackLoggerPositive('warning', `[${prefix}] ${txid} not blocked on ${gw} (status: ${status})`)
			return;
		}
		logger(prefix, `OK. ${txid} blocked on ${gw} (status:${status})`)
		slackLogger(prefix, `OK. ${txid} blocked on ${gw} (status:${status})`)
	}) )

}, INTERVAL);

const streamToString = async(stream: Readable)=> {
	const chunks = [];
	for await (const chunk of stream) {
		// console.log(`pushing chunk`, (chunk as Buffer).toString('utf-8'))
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf-8");
}
