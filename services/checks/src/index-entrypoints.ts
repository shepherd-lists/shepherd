import { RangelistAllowedItem } from "../../webserver-next/src/webserver-types"
import { checkServerBlockingChunks } from "./ranges-checkOverlap"
import { checkServerBlockingTxids } from "./txids-checkHeads"



/* load the access lists */
const rangeItems: RangelistAllowedItem[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
const gwUrls: string[] = JSON.parse(process.env.GW_URLS || '[]')
console.info({ rangeItems, gwUrls })

/* semaphore to prevent overlapping runs */
let _running: { [key: string]: boolean } = {}

/** 
 * txid checks 
 */

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

/**
 * range checks
 */

export const checkRanges = async () => {
	/** short-circuit */
	if (rangeItems.length === 0) {
		console.info(checkRanges.name, 'no range check items configured, exiting.')
		return
	}

	if (_running['rangechecks']) {
		console.info(checkRanges.name, `already running. exiting.`)
		return
	}
	_running['rangechecks'] = true
	const d0 = Date.now()
	try {

		await Promise.all(rangeItems.map(async item => checkServerBlockingChunks(item)))

		//TODO: might be errors to catch here?

	} finally {
		delete _running['rangechecks']
	}
	console.info(checkRanges.name, `finished in ${(Date.now() - d0).toLocaleString()} ms`)
}

