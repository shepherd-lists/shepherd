import { checkServerTxids } from "./txids-checkHeads"
import { FolderName } from "../types"
import { MessageType } from ".."
import { slackLog } from "../../../../libs/utils/slackLog"
import { addonTxsTableNames } from '../../../../libs/utils/addon-tablenames'



const FLAGGED_INTERVAL = 30_000 // 30 secs 
const OWNERS_INTERVAL = 300_000 // 5 mins N.B. owners will be large and take hours to complete
const DNSR_INTERVAL = 600_000 // 10 mins


/** let the main thread know there's a problem */
process.on('uncaughtException', (e, origin) => {
	console.error('[txids] uncaughtException', e)
	process.send!(<MessageType>{ type: 'uncaughtException' })
	// process.exit(1)
})
process.on('unhandledRejection', (e, origin) => {
	console.error('[txids] unhandledRejection (this could be handled and process continue)', e, origin)
	process.exit(7)
})

process.on('SIGINT', () => {
	console.info('[txids] SIGINT')
	process.exit(1)
})
process.on('SIGTERM', () => {
	console.info('[txids] SIGTERM')
	process.exit(1)
})
process.on('exit', (code: number) => {
	console.info('[txids] exit', code)
	process.send!(<MessageType>{ type: 'uncaughtException' }) //just send this for every shutdown
	slackLog('[txids] exit', code)
	// process.exit(code)
})


/** ! ensure entrypoints run after process.on handlers are setup ! */


/* load the access lists */
const gwDomains: string[] = JSON.parse(process.env.GW_DOMAINS || '[]')
console.info({ gwDomains })

/* semaphore to prevent overlapping runs */
let _running: { [key: string]: boolean } = {}

/** 
 * txid checks 
 */
export const checkTxids = async (key: FolderName) => {
	/** short-circuit */
	if (gwDomains.length === 0) {
		console.info(checkTxids.name, key, 'no gw domains configured, exiting.', gwDomains)
		return
	}
	/** no overlapping runs */
	if (_running[key]) {
		console.info(checkTxids.name, key, `already running. exiting.`)
		return
	}
	_running[key] = true
	console.info(checkTxids.name, key, `starting cronjob...`, JSON.stringify({ gwDomains, _running }))
	try {

		await Promise.all(gwDomains.map(async (gwDomain) => checkServerTxids(gwDomain, key)))

		//TODO: might be timeouts to catch here?

	} finally {
		delete _running[key]
	}
}

/** txid & alarm entrypoints after process event handlers */

setInterval(() => checkTxids('flagged/'), FLAGGED_INTERVAL)
setInterval(() => checkTxids('owners/'), OWNERS_INTERVAL)
checkTxids('owners/') //start early
const addonKeys = (await addonTxsTableNames()).map(t => `${t.split('_')[0]}/`) as `${string}/`[]
console.info(JSON.stringify({ addonKeys }))
addonKeys.map(key => setInterval(() => checkTxids(key), DNSR_INTERVAL))




