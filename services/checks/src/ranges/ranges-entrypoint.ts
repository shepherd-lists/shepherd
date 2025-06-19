import { checkServerRanges } from "./ranges-checkOverlap"
import { MessageType } from '..'
import { slackLog } from "../../../../libs/utils/slackLog"
import { rangeAllowed } from "../../../../libs/utils/update-range-nodes"



/** let the main thread know there's a problem */
process.on('uncaughtException', (e, origin) => {
	console.error('[ranges] uncaughtException', e)
	process.send!(<MessageType>{ type: 'uncaughtException' })
	// process.exit(1)
})
process.on('unhandledRejection', (e, origin) => {
	console.error('[ranges] unhandledRejection (this could be handled and process continue)', e, origin)
	process.exit(7)
})

process.on('SIGINT', () => {
	console.info('[ranges] SIGINT')
	process.exit(1)
})
process.on('SIGTERM', () => {
	console.info('[ranges] SIGTERM')
	process.exit(1)
})
process.on('exit', (code: number) => {
	console.info('[ranges] exit', code)
	process.send!(<MessageType>{ type: 'uncaughtException' }) //just send this for every shutdown
	slackLog('[ranges] exit', code)
	// process.exit(code)
})


/** ! ensure entrypoints run after process.on handlers are setup ! */

/* semaphore to prevent overlapping runs */
let _running: { [key: string]: boolean } = {}

/**
 * range checks. relatively uncomplicated to run.
 */
const checkRanges = async () => {
	/** grab the current rangeItems */
	const rangeItems = rangeAllowed()

	/** short-circuit */
	if (rangeItems.length === 0) {
		console.info(checkRanges.name, 'no range check items configured, exiting.')
		return
	}

	if (_running['rangechecks'] === true) {
		console.info(checkRanges.name, `already running. exiting.`)
		return
	}
	_running['rangechecks'] = true
	console.info(checkRanges.name, `starting cronjob...`, JSON.stringify({ rangeItems, _running }))
	const d0 = Date.now()
	try {

		await Promise.all(rangeItems.map(async item => checkServerRanges(item)))

	} finally {
		delete _running['rangechecks']
	}
	console.info(checkRanges.name, `finished in ${(Date.now() - d0).toLocaleString()} ms`, { _running })
}

/** run the task */
const RANGES_INTERVAL = 60_000 // 1 min
setInterval(checkRanges, RANGES_INTERVAL)
checkRanges()
