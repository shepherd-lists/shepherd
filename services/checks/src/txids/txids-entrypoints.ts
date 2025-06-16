import { checkServerTxids } from "./txids-checkHeads"
import { FolderName } from "../types"


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

