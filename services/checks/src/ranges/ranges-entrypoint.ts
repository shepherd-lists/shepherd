import { checkServerRanges } from "./ranges-checkOverlap"
import { MessageType } from '..'
import { NotBlockStateDetails } from "../event-tracking"
import { randomUUID } from "crypto"
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

type PendingRequest = {
	resolve: (value: any) => void
	reject: (reason?: any) => void //remove?
}
const _pendingRequests: { [reqid: string]: PendingRequest } = {}
/** process received messages from main */
process.on('message', (message: MessageType) => {
	// console.debug('[ranges] received', JSON.stringify(message))
	if (message.type === 'returnAlarms' && _pendingRequests[message.reqid]) {
		_pendingRequests[message.reqid].resolve(message.alarms)
		delete _pendingRequests[message.reqid]
	}
})

// const _serverAlarmRequestQ: { [reqid: string]: { [line: string]: NotBlockStateDetails } } = {}
export const getServerAlarmsIPC = (server: string): Promise<{ [line: string]: NotBlockStateDetails }> => {
	return new Promise((resolve, reject) => {
		const reqid = randomUUID()
		_pendingRequests[reqid] = { resolve, reject } //this will hold the response
		process.send!(<MessageType>{ type: 'getServerAlarms', server, reqid })
	})
}

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

	if (_running['rangechecks']) {
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
