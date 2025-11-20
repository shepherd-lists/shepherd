/**
 * objectives:
 * - check that servers in access lists are correctly blocking data after it is flagged.
*
* this file contains only the timers
*/
import { ChildProcess, fork } from 'child_process'
import { NotBlockStateDetails, alertStateCronjob, getServerAlarms } from './event-tracking'
import { NotBlockEvent, setAlertState } from './event-tracking'
import { slackLog } from '../../../libs/utils/slackLog'



/** we're gonna fork all these tasks into a separate processes */


const children: ChildProcess[] = []

// Add memory monitoring
const logMemoryUsage = () => {
	const memUsage = process.memoryUsage()
	console.log('[main] Memory usage:', JSON.stringify({
		rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
		heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
		heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
		external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
	}))
}

// Monitor memory every 30 seconds
setInterval(logMemoryUsage, 60000)

children.push(fork(
	new URL('./ranges/ranges-entrypoint.ts', import.meta.url).pathname,
	{ stdio: 'inherit' }
))
children.push(fork(
	new URL('./txids/txids-entrypoints.ts', import.meta.url).pathname,
	{ stdio: 'inherit' }
))



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
	c.on('exit', (code, signal) => {
		console.log(`child process ${c.pid} exited with code ${code} and signal ${signal}`)
		cleanUpAndExit(`child process ${c.pid} exited with code ${code} and signal ${signal}`)
	})
}

const cleanUpAndExit = async (msg?: string) => {
	await slackLog('💀 [checks-service] killing all child processes ❌', msg)
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
	console.log(`[main] exiting with code ${code}`)
	cleanUpAndExit()
})
process.on('uncaughtException', (e, origin) => {
	// !!! "It is not safe to resume normal operation after 'uncaughtException'." !!!
	slackLog('[main] uncaught exception', JSON.stringify({ e, origin }))
	cleanUpAndExit()
})
process.on('unhandledRejection', (reason, promise) => {
	slackLog('[main] unhandled rejection at:', JSON.stringify({ promise, reason }))
	cleanUpAndExit()
})



/** [main entry] cron for alarm state */

setInterval(alertStateCronjob, 10_000)


