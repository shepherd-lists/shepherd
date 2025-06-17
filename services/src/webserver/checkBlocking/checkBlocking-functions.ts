/**
 * objectives:
 * - check that IPs in lists are correctly blocking data after it is flagged.
 *
 * this file separates out the functions for test.
 */
import { PassThrough } from 'stream'
import readline from 'readline'
import { logger } from '../../common/utils/logger'
import { slackLogger } from '../../common/utils/slackLogger'
import { slackLoggerPositive } from '../../common/utils/slackLoggerPositive'
import { getBlacklist, getRangelist } from '../blacklist'
import { fetch_checkBlocking } from './fetch-checkBlocking'
import { alarmsInAlert, deleteUnreachable, isUnreachable, setAlertState, setUnreachable, unreachableServers, unreachableTimedout } from './event-tracking'
import { RangelistAllowedItem, LogEvent } from '../webserver-types'


const prefix = 'check-blocked'

const hour_ms = 60 * 60 * 1000


/* load the IP access lists */

// pop off first IP. this should always be a test IP
const rangeItems: RangelistAllowedItem[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
// accessRangelist.shift() // pop off first IP. this should always be a test IP
logger(prefix, 'parse(RANGELIST_ALLOWED)', rangeItems)

const gwDomains: string[] = JSON.parse(process.env.GW_URLS || '[]')
logger(prefix, 'gwDomains', gwDomains)

let _running = false
export const checkBlockedCronjob = async () => {

	logger(prefix, `starting ${checkBlockedCronjob.name}() cronjob...`, { rangeItems, gwDomains, _running })
	if(_running){
		logger(prefix, `${checkBlockedCronjob.name}() already running. exiting...`)
		return
	}
	_running = true


	try{

		/* check all blacklist txids against GWs */

		if(gwDomains.length === 0){
			logger(prefix, 'gwDomains empty. nothing to check txids against.')
		}else{
			// we're reusing the server's streaming function
			const rwBlack = new PassThrough()

			getBlacklist(rwBlack).then(() => rwBlack.end())

			const txids = readline.createInterface(rwBlack)
			for await (const txid of txids){
				(process.env.NODE_ENV === 'test') && console.log('readline txid', txid)

				await Promise.all(gwDomains.map(async gw => {
					try{
						if(!isUnreachable(gw) || unreachableTimedout(gw)){
							await checkBlocked(`https://${gw}/${txid}`, txid, {name: gw, server: gw})
							//if didn't throw error, then it's reachable
							deleteUnreachable(gw)
						}
					}catch(e){
						setUnreachable({ name: gw, server: gw})
						logger(prefix, `gateway ${gw} is unreachable! while fetching ${gw}/${txid}`, txid)
						slackLogger(prefix, `gateway ${gw} is unreachable! while fetching ${gw}/${txid}`, txid)
					}
				}))
			}
			rwBlack.destroy(); txids.close()
		}

		/* check all ranges against nodes (and GWs too?) */

		if(gwDomains.length === 0 && rangeItems.length === 0){
			logger(prefix, 'gwDomains & accessRangelist empty. nothing to check byteranges against.')

		}else{
			const rwRange = new PassThrough()
			getRangelist(rwRange).then(() => rwRange.end())	//byte-range already calculated

			const ranges = readline.createInterface(rwRange)
			for await (const range of ranges){
				(process.env.NODE_ENV === 'test') && console.log('readline range', range)

				const [range1, range2] = range.split(',')

				await Promise.all(gwDomains.map(async gw => {
					try{
						if(!isUnreachable(gw) || unreachableTimedout(gw)){
							await checkBlocked(`${gw}/chunk/${+range1 + 1}`, range, {name: gw, server: gw})
							//if didn't throw error, then it's reachable
							deleteUnreachable(gw)
						}
					}catch(e){
						setUnreachable({name: gw, server: gw})
						logger(prefix, `gateway ${gw} is unreachable! while fetching ${gw}/chunk/${+range1 + 1}`, range)
						slackLogger(prefix, `gateway ${gw} is unreachable! while fetching ${gw}/chunk/${+range1 + 1}`, range)
					}
				}))
				await Promise.all(rangeItems.map(async item => {
					try{
						if(!isUnreachable(item.server) || unreachableTimedout(item.server)){
							await checkBlocked(`http://${item.server}:1984/chunk/${+range1 + 1}`, range, item)
							//if didn't throw error, then it's reachable
							deleteUnreachable(item.server)
						}
					}catch(e){
						setUnreachable(item)
						logger(prefix, `set '${item.name}' as unreachable, while fetching http://${item.server}:1984/chunk/${+range1 + 1}`)
					}
				}))
			}
			rwRange.destroy(); ranges.close()
		}
	} finally {
		const urs = unreachableServers()
		console.log(checkBlockedCronjob.name,
			`finished. alarms: ${alarmsInAlert().number} unreachable servers: ${urs.number}, ${JSON.stringify(urs.names)}`
		)
		_running = false
	}
}


export const checkBlocked = async (url: string, item: string, server: RangelistAllowedItem) => {
	let response: { res: Response, aborter?: AbortController } | undefined = undefined
	try{
		response = await fetch_checkBlocking(url)
		const { res: { status, headers } } = response

		if(status >= 500){
			logger(prefix, `server ${server} returned ${status} for ${url}. Skipping...`)
			return
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
					age: headers.get('age') || headers.get('x-77-age') || 'null',
					contentLength: headers.get('content-length') || 'null',
					httpStatus: status,
					endpointType: item.length === 43 ? '/TXID' : '/chunk',
				},
			})

			/* make sure Slack doesn't display link contents */

			const nodisplay = url.split('/')
			let display = url
			if(nodisplay.length === 4){
				nodisplay.pop()
				display = nodisplay.join('/')
			}
			slackLoggerPositive('warning', `[${prefix}] ${item} not blocked on \`${display}\` (status: ${status}), xtrace: '${headers.get('x-trace')}', age: '${headers.get('age')}', content-length: '${headers.get('content-length')}'`)
		}else{
			// logger(prefix, `OK. ${item} blocked on ${url} (status:${status})`) //too verbose
			setAlertState({ server, item, status: 'ok' })
		}
	} finally {
		response?.aborter?.abort()
	}

}

