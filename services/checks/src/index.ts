/**
 * objectives:
 * - check that servers in access lists are correctly blocking data after it is flagged.
*
* this file contains only the timers
*/
import { ChildProcess, fork } from 'child_process'
import { NotBlockStateDetails, alertStateCronjob, getServerAlarms } from './event-tracking'
import { NotBlockEvent, setAlertState } from './event-tracking'
import { checkTxids } from './txids/txids-entrypoints'
import { slackLog } from '../../../libs/utils/slackLog'
import { addonTxsTableNames } from '../../../libs/utils/addon-tablenames'


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
			cleanUpAndExit()
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

const cleanUpAndExit = async () => {
	await slackLog('killing all child processes')
	children.forEach(child => child.kill())
	process.exit(1)
}

process.on('SIGINT', () => {
	console.info('[main] SIGINT received')
	cleanUpAndExit()
})
process.on('SIGTERM', () => {
	console.info('[main] SIGTERM received')
	cleanUpAndExit()
})

/** ensure no orphans are created */
process.on('exit', (code) => {
	console.log(`exiting with code ${code}`)
	cleanUpAndExit()
})
process.on('uncaughtException', (e, origin) => {
	// !!! "It is not safe to resume normal operation after 'uncaughtException'." !!!
	slackLog('[main] uncaught exception', JSON.stringify({ e, origin }))
	cleanUpAndExit()
})
process.on('unhandledRejection', (reason, promise) => {
	slackLog('unhandled rejection at:', JSON.stringify({ promise, reason }))
	cleanUpAndExit()
})


/** txid & alarm entrypoints after process event handlers */

setInterval(() => checkTxids('txidflagged.txt'), FLAGGED_INTERVAL)
setInterval(() => checkTxids('txidowners.txt'), OWNERS_INTERVAL)
checkTxids('txidowners.txt') //start early
const addonKeys = (await addonTxsTableNames()).map(t => `${t.split('_')[0]}/txids.txt`) as `${string}/txids.txt`[]
console.info(JSON.stringify({ addonKeys }))
addonKeys.map(key => setInterval(() => checkTxids(key), DNSR_INTERVAL))


/** cron for alarm state */
setInterval(alertStateCronjob, 10_000) 
