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
	alarms: { [line: string]: NotBlockStateDetails }
}
const _alerts: { [server: string]: NotBlockState } = {} // new Map<string, NotBlockState>()
let _changed = false

export const alarmsInAlert = () => {
	return {
		number: _alerts.size,
		list: _alerts,
	}
}
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
	if (!_changed)
		return;

	_running = true //lock
	const t0 = performance.now()
	_changed = false //reset


	let earliestStart = Date.now().valueOf() //for pagerduty alert

	console.debug(alertStateCronjob.name, 'DEBUG', 'servers', Object.keys(_alerts).length)

	/** loop through servers in alerts */
	for (const [server, state] of Object.entries(_alerts)) {
		const { serverName, serverType, alarms } = state

		/** server message head */
		const alarmEntries = Object.entries(alarms)
		let serverDisplayLimit = 10 //limit num of alarms to prevent notification spam
		let serverMsg = `-= ${serverName ? serverName + ' ' : ''}\`${server}\` ${new Date().toUTCString()}. ${alarmEntries.length} entries. (display limited to ${serverDisplayLimit} alarm starts)\n`
		const headerLength = serverMsg.length

		console.debug(alertStateCronjob.name, 'DEBUG', serverName || server, 'entries', alarmEntries.length)

		/** for nodes, skip if they have already made an "alarm" notification */
		if (serverType === 'node') {
			const details = Object.values(alarms)
			console.debug(JSON.stringify({ serverName, details }))
			const inAlarm = details.some(({ status, notified }) => status === 'alarm' && notified === true)
			if (inAlarm) {
				console.debug(`detected ${serverName} inAlarm=${inAlarm}. skipping`)
				continue;
			}

		}

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
		if (Date.now() - earliestStart > 600_000) {
			console.debug('PAGER_ALERT:', serverMsg, serverName || server)
			pagerdutyAlert(serverMsg, serverName || server)
		}
	}//for _alerts

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

/** *** USED ONLY IN TEST! *** reset server alert state */
export const _resetAlertState = () => {
	Object.keys(_alerts).forEach(key => delete _alerts[key])
	_changed = false
}
