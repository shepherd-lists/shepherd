import { RangelistAllowedItem } from "../types"
import { checkServerRanges } from "./ranges-checkOverlap"
import { MessageType } from '..'
import { NotBlockStateDetails } from "../event-tracking"
import { randomUUID } from "crypto"



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

/** let the main thread know there's a problem */
process.on('uncaughtException', (e, origin) => {
	console.error('[ranges] uncaughtException', e)
	process.send!(<MessageType>{ type: 'uncaughtException' })
	process.exit(1)
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


/** run the task */
const RANGES_INTERVAL = 60_000 // 1 min
setInterval(checkRanges, RANGES_INTERVAL)
checkRanges()
