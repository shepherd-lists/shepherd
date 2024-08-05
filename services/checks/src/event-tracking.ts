import { pagerdutyAlert } from './pagerduty-alert'
import { performance } from 'perf_hooks'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** -= track start/end of not-block events =- */

interface NotBlockEventDetails {
	line: string //key: id or range
	status: ('alarm' | 'ok')
	endpointType: '/TXID' | '/chunk'
	/** below irrelevent for dsr range checks */
	xtrace?: string
	age?: string
	contentLength?: string
	httpStatus?: number
}
export interface NotBlockEvent {
	server: string //key
	serverName?: string //dont need this for gateways
	serverType: 'gw' | 'node'
	details: NotBlockEventDetails
}
export interface NotBlockStateDetails extends NotBlockEventDetails {
	startStamp: number
	endStamp?: number //make sure to catch first 'ok' event and not overwrite
	notified: boolean //once "ok" notified, delete state  
}
interface NotBlockState {
	server: string //key
	serverName?: string //dont need this for gateways
	serverType: 'gw' | 'node'
	pageralertRaised?: boolean
	alarms: { [line: string]: NotBlockStateDetails }
}
const _alerts: { [server: string]: NotBlockState } = {} // new Map<string, NotBlockState>()
let _changed = false

export const alarmsInAlert = () => ({ number: _alerts.size, list: _alerts })
export const existAlertState = (server: string) => !!_alerts[server]
export const existAlertStateLine = (server: string, line: string) => !!_alerts[server]?.alarms[line] //&& with existAlertState above
export const getServerAlarms = (server: string) => _alerts[server]?.alarms || {}

export const setAlertState = (event: NotBlockEvent) => {
	const server = event.server
	const line = event.details.line
	const status = event.details.status
	if (status === 'ok' && (!_alerts[server] || !_alerts[server].alarms[line])) return; //should use existAlertState instead

	/** set first server alarm */
	if (!_alerts[server]) {
		_alerts[server] = {
			server,
			serverName: event.serverName,
			serverType: event.serverType,
			alarms: {
				[event.details.line]: {
					...event.details,
					notified: false,
					startStamp: Date.now(),
				}
			},
		}
		_changed = true
		return;
	}
	/** set subsequent new alarms */
	if (!_alerts[server].alarms[line]) {
		_alerts[server].alarms[line] = {
			...event.details,
			notified: false,
			startStamp: Date.now(),
		}
		_changed = true
		return;
	}

	/** check for changed state */
	const alarms = _alerts[server].alarms;

	if (alarms[line].status !== status) {
		_alerts[server].alarms[line] = {
			...alarms[line],
			status,
			notified: false,
			endStamp: Date.now(),
		}
		_changed = true
	}
	/** if the status is the same, we don't need to update the state */
	/** deletion handled after "OK" notification sent */
}

/** cronjob function to report alert changes */
let _running = false
export const alertStateCronjob = () => {
	if (_running) {
		console.info(alertStateCronjob.name, 'cronjob still running, exiting.')
		return;
	}
	console.debug(alertStateCronjob.name, 'running cronjob...', { _changed, '_alerts.size': Object.keys(_alerts).length })
	if (!_changed) {
		console.info(alertStateCronjob.name, 'nothing changed, exiting.')
		return;
	}

	_running = true //lock
	_changed = false //reset
	const t0 = performance.now()

	console.debug(alertStateCronjob.name, 'DEBUG', 'servers', Object.keys(_alerts).length)

	/** separate nodes and gws */
	const [gwAlerts, nodeAlerts] = Object.entries(_alerts).reduce((result, [key, state]) => {
		result[state.serverType === 'gw' ? 0 : 1][key] = state
		return result
	},
		[{}, {}] as [{ [server: string]: NotBlockState }, { [server: string]: NotBlockState }] //starting array of objects
	)

	/** loop through gw alerts */
	for (const [server, state] of Object.entries(gwAlerts)) {
		const { serverName, alarms } = state

		/** server message head */
		const alarmEntries = Object.entries(alarms)
		let serverDisplayLimit = 10 //limit num of alarms to prevent notification spam
		let serverMsg = `-= ${serverName ? serverName + ' ' : ''}\`${server}\` ${new Date().toUTCString()}. ${alarmEntries.length} entries. (display limited to ${serverDisplayLimit} alarm starts)\n`
		const headerLength = serverMsg.length

		console.debug(alertStateCronjob.name, 'DEBUG gwAlerts', serverName || server, 'entries', alarmEntries.length)

		let earliestStart = Infinity //for pagerduty alert

		/** loop thru this server's alarm states */
		for (const [line, details] of alarmEntries) {
			const { status, startStamp, endStamp, endpointType, notified } = details

			if (status === 'alarm' && startStamp < earliestStart) earliestStart = startStamp //for pagerduty

			const createServerLine = () => {
				let serverLine = ''
				const startDatestring = new Date(startStamp).toUTCString()
				if (status === 'ok') {
					const d = endStamp! - startStamp
					const dMins = (d / 60_000).toFixed(0)
					const dSecs = ((d % 60_000) / 1000).toFixed(0)
					const endDateString = new Date(endStamp!).toUTCString()
					serverLine += `🟢 OK. Alarm duration ${dMins}m ${dSecs}s. \`${endpointType}\` start:"${startDatestring}", end:"${endDateString}".`
				} else { /* status === 'alarm */
					serverLine += `🔴 ALARM. \`${endpointType}\` start:"${startDatestring}".`
				}
				if (details.contentLength || details.xtrace) {
					const { xtrace, age, httpStatus, contentLength } = details
					serverLine += ' ' + JSON.stringify({ xtrace, age, httpStatus, contentLength })
				}
				serverLine += '\n'
				return serverLine;
			}

			if (!notified) {
				alarms[line].notified = true
				if (status === 'ok') {
					serverMsg += createServerLine()
					delete alarms[line]
					if (Object.keys(alarms).length === 0) {
						delete _alerts[server]
					}
				} else { /* status === 'alarm */
					if (serverDisplayLimit-- > 0) {
						serverMsg += createServerLine()
					}
				}
			}

		}//for alarms

		if (serverMsg.length > headerLength)
			_slackLoggerNoFormatting(serverMsg, process.env.SLACK_PROBE) //print per server
		if (!state.pageralertRaised && Date.now() - earliestStart > 600_000) {
			state.pageralertRaised = true
			console.debug('PAGER_ALERT:', serverMsg, serverName || server)
			pagerdutyAlert(serverMsg, serverName || server)
		}
	}//for-of gwAlerts

	processNodeAlerts(nodeAlerts)

	/* finish up */
	console.info(`${alertStateCronjob.name} running time ${(performance.now() - t0).toFixed(0).toLocaleString()} ms`)
	_running = false
}

/** exported for test only */
export const _slackLoggerNoFormatting = (text: string, hook?: string) => {
	console.log(_slackLoggerNoFormatting.name, '\n', text)
	if (hook) {
		fetch(hook, { method: 'POST', body: JSON.stringify({ text }) })
			.then(res => res.text()).then(t => console.log(_slackLoggerNoFormatting.name, `response: ${t}`)) //use up stream to close connection
			.catch(e => {
				console.log('ERROR! FAILED TO SEND SLACK NOTIFICATION!', e, 'retrying')
				sleep(5_000).then(() => _slackLoggerNoFormatting(text, hook))
			})
	}
}

/** handling the node code separately, it's just too different now */
const _summarizedNodeStates: { [server: string]: { start: EpochTimeStamp; pagerdutyRaised?: boolean } } = {}
const processNodeAlerts = (nodeAlerts: { [server: string]: NotBlockState }) => {
	for (const [server, state] of Object.entries(nodeAlerts)) {
		const { serverName, alarms } = state

		/** Plan:
		 * first alarm
		 *   - send slack
		 *   - new state summary
		 * if server in Alarm or OK < 5mins old
		 *   - remain in alarm state
		 * if server OK > 5mins old
		 *   - server to OK state
		 *   - send slack and delete server & actual alarms
		 * continue to next server
		 * 
		 */

		console.debug(alertStateCronjob.name, 'DEBUG nodeAlerts', serverName, 'entries', Object.keys(alarms).length)

		const alarmStates = Object.values(alarms) //make things more simple
		const earliestStart = alarmStates.reduce((prev, curr) => curr.startStamp < prev.startStamp ? curr : prev, { startStamp: Infinity } as NotBlockStateDetails).startStamp

		/** first check if it's a new alarm */
		if (!_summarizedNodeStates[server]) {
			_summarizedNodeStates[server] = { start: earliestStart }

			const serverMsg = `🔴 ALARM.  \`${serverName} ${server}\`, started: ${new Date(earliestStart).toUTCString()}.`
			_slackLoggerNoFormatting(serverMsg, process.env.SLACK_PROBE)
			continue;
		}

		/** check if this is the final OK */
		const threshold = Date.now() - 420_000 //now - 7mins
		const okAndOlderThanThreshold = alarmStates.every(alarm => alarm.status === 'ok' && alarm.endStamp! < threshold)
		if (okAndOlderThanThreshold) {
			//write the last notification
			const lastEnd = alarmStates.reduce((prev, curr) => curr.endStamp! > prev.endStamp! ? curr : prev, { endStamp: 0 } as NotBlockStateDetails).endStamp!
			const d = (lastEnd - earliestStart)
			const dMins = (d / 60_000).toFixed(0)
			const dSecs = ((d % 60_000) / 1000).toFixed(0)
			const serverMsg = `🟢 OK.  \`${serverName} ${server}\`, duration: ${dMins}m ${dSecs}s, started: ${new Date(earliestStart).toUTCString()}. ended: ${new Date(lastEnd).toUTCString()}`
			_slackLoggerNoFormatting(serverMsg, process.env.SLACK_PROBE)
			//cleanup
			delete _summarizedNodeStates[server]
			delete _alerts[server]
			continue;
		}

		/** cleanup some OK alarms */
		const oks = alarmStates.filter(s => s.status === 'ok')
		if (oks.length > 2) {
			const newest = oks.reduce((prev, curr) => curr.endStamp! > prev.endStamp! ? curr : prev, { endStamp: 0 } as NotBlockStateDetails)
			_alerts[server].alarms = { [newest.line]: newest }
		}

		/** send pagerdutyAlert once if over 10 mins */
		if (!_summarizedNodeStates[server].pagerdutyRaised && Date.now() - earliestStart > 600_000) {
			_summarizedNodeStates[server].pagerdutyRaised = true
			const msg = `🔴 ALARM.  \`${serverName} ${server}\`, started: ${new Date(earliestStart).toUTCString()}.`
			console.info('PAGER_ALERT:', msg)
			pagerdutyAlert(msg, serverName!)
		}

	}//for _alerts
}