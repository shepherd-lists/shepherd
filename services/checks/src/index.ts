/**
 * objectives:
 * - check that servers in access lists are correctly blocking data after it is flagged.
*
* this file contains only the timers
*/
import { ChildProcess, fork } from 'child_process'
import { NotBlockStateDetails, alertStateCronjob, getServerAlarms } from './event-tracking'
import { NotBlockEvent, setAlertState } from './event-tracking'
import { checkFlaggedTxids, checkOwnersTxids } from './txids/txids-entrypoints'
import { slackLog } from '../../../libs/utils/slackLog'


const FLAGGED_INTERVAL = 30_000 // 30 secs 
const OWNERS_INTERVAL = 300_000 // 5 mins N.B. owners will be large and take hours to complete
const DNSR_INTERVAL = 600_000 // 10 mins




/** we're gonna fork all these tasks into a separate processes */


const children: ChildProcess[] = []

const rangesProcess = () => {
	const worker = fork(
		new URL('./ranges/ranges-entrypoint.ts', import.meta.url).pathname,
		{ stdio: 'inherit' }
	)
	return worker
}
children.push(rangesProcess())

/** wire up child messages for state changes and unhandled errors */
export type MessageType =
	{ type: 'uncaughtException' }
	| { type: 'setState', newState: NotBlockEvent }
	| { type: 'getServerAlarms', reqid: string, server: string }
	| { type: 'returnAlarms', reqid: string, alarms: { [server: string]: NotBlockStateDetails } }

for (const c of children) {
	c.on('message', (message: MessageType) => {
		// console.debug('[main] received', JSON.stringify(message))
		if (message.type === 'uncaughtException') {
			cleanUp()
			process.exit(1)
		}
		if (message.type === 'setState') {
			setAlertState(message.newState!)
		}
		if (message.type === 'getServerAlarms') {
			const returnAlarms: MessageType = {
				type: 'returnAlarms',
				alarms: getServerAlarms(message.server),
				reqid: message.reqid,
			}
			c.send(returnAlarms)
		}
	})
}

const cleanUp = () => {
	slackLog('killing all child processes')
	children.forEach(child => child.kill())
}

process.on('SIGINT', () => {
	console.info('[main] SIGINT received')
	cleanUp()
	process.exit(1)
})
process.on('SIGTERM', () => {
	console.info('[main] SIGTERM received')
	cleanUp()
	process.exit(1)
})

/** ensure no orphans are created */
process.on('exit', (code) => {
	console.log(`exiting with code ${code}`)
	cleanUp()
})
process.on('uncaughtException', (e, origin) => {
	// !!! "It is not safe to resume normal operation after 'uncaughtException'." !!!
	slackLog('[main] uncaught exception', JSON.stringify({ e, origin }))
	cleanUp()

	throw e;
})
process.on('unhandledRejection', (reason, promise) => {
	slackLog('unhandled rejection at:', JSON.stringify({ promise, reason }))
	cleanUp()
	process.exit(7)
})


/** txid & alarm entrypoints after process event handlers */

setInterval(checkFlaggedTxids, FLAGGED_INTERVAL)
setInterval(checkOwnersTxids, OWNERS_INTERVAL)
checkOwnersTxids() //start early

/** cron for alarm state */
setInterval(alertStateCronjob, 10_000) 
