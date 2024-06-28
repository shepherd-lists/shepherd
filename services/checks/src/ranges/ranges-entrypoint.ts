import { RangelistAllowedItem } from "../types"
import { checkServerRanges } from "./ranges-checkOverlap"



/* load the access lists */
const rangeItems: RangelistAllowedItem[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
console.info({ rangeItems })

/* semaphore to prevent overlapping runs */
let _running: { [key: string]: boolean } = {}

/**
 * range checks. relatively uncomplicated to run.
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
	console.info(checkRanges.name, `starting cronjob...`, JSON.stringify({ rangeItems, _running }))
	const d0 = Date.now()
	try {

		await Promise.all(rangeItems.map(async item => checkServerRanges(item)))

		//TODO: might be errors to catch here?

	} finally {
		delete _running['rangechecks']
	}
	console.info(checkRanges.name, `finished in ${(Date.now() - d0).toLocaleString()} ms`)
}

