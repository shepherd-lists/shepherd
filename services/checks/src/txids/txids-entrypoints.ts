import { checkServerTxids } from "./txids-checkHeads"
import { FolderName } from "../types"


/* load the access lists */
const gwUrls: string[] = JSON.parse(process.env.GW_URLS || '[]')
console.info({ gwUrls })

/* semaphore to prevent overlapping runs */
let _running: { [key: string]: boolean } = {}

/** 
 * txid checks 
 */
export const checkTxids = async (key: FolderName) => {
	/** short-circuit */
	if (gwUrls.length === 0) {
		console.info(checkTxids.name, key, 'no gw urls configured, exiting.', gwUrls)
		return
	}
	/** no overlapping runs */
	if (_running[key]) {
		console.info(checkTxids.name, key, `already running. exiting.`)
		return
	}
	_running[key] = true
	console.info(checkTxids.name, key, `starting cronjob...`, JSON.stringify({ gwUrls, _running }))
	try {

		await Promise.all(gwUrls.map(async (gwUrl) => checkServerTxids(gwUrl, key)))

		//TODO: might be timeouts to catch here?

	} finally {
		delete _running[key]
	}
}

