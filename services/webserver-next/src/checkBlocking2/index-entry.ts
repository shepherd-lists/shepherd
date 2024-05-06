import { RangelistAllowedItem } from "../webserver-types"
import { checkServerBlockingTxids } from "./txids-checkHeads"



/* load the access lists */
const rangeItems: RangelistAllowedItem[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
const gwUrls: string[] = JSON.parse(process.env.GW_URLS || '[]')
console.info({ rangeItems, gwUrls })

let _running: { [key: string]: boolean } = {} //semaphore to prevent overlapping runs

const checkTxids = async (key: 'txidflagged.txt' | 'txidowners.txt') => {
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
	console.info(checkTxids.name, key, `starting cronjob...`, JSON.stringify({ rangeItems, gwUrls, _running }))
	try {

		await Promise.all(gwUrls.map(async (gwUrl) => checkServerBlockingTxids(gwUrl, key)))

		//TODO: might be timeouts to catch here?

	} finally {
		delete _running[key]
	}
}

export const checkFlaggedTxids = () => checkTxids('txidflagged.txt')
export const checkOwnersTxids = () => checkTxids('txidowners.txt')
