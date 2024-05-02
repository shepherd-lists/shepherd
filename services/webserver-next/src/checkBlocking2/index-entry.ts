import { RangelistAllowedItem } from "../webserver-types"
import { checkServerBlockingTxids } from "./txids-checkHeads"



/* load the access lists */
const rangeItems: RangelistAllowedItem[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
const gwUrls: string[] = JSON.parse(process.env.GW_URLS || '[]')
console.info({ rangeItems, gwUrls })

let _running = false
export const checkFlaggedTxids = async () => {

	/** short-circuit */
	if (gwUrls.length === 0) {
		console.info(checkFlaggedTxids.name, 'no gw urls configured, exiting.', gwUrls)
		return
	}
	/** no overlapping runs */
	if (_running) {
		console.info(checkFlaggedTxids.name, `already running. exiting.`)
		return
	}
	console.info(checkFlaggedTxids.name, `starting cronjob...`, { rangeItems, gwUrls, _running })
	_running = true
	try {

		await Promise.all(gwUrls.map(async (gwUrl) => checkServerBlockingTxids(gwUrl, 'txidflagged.txt')))

		//TODO: might be timeouts to catch here?

	} finally {
		_running = false
	}
}