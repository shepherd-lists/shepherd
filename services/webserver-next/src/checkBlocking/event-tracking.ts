import { pagerdutyAlert } from './pagerduty-alert'

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
	details: NotBlockEventDetails
}
interface NotBlockStateDetails extends NotBlockEventDetails {
	startStamp: number
	endStamp?: number //make sure to catch first 'ok' event and not overwrite
	notified: boolean //once "ok" notified, delete state  
}
interface NotBlockState {
	server: string //key
	serverName?: string //dont need this for gateways
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
export const existAlertStateLine = (server: string, line: string) => !!_alerts[server]?.alarms[line] //fix this

export const setAlertState = (event: NotBlockEvent) => {
	const server = event.server
	const line = event.details.line
	if (event.details.status === 'ok' && (!_alerts[server] || !_alerts[server].alarms[line])) return; //should use existAlertState instead

	/** set first server alarm */
	if (!_alerts[server]) {
		_alerts[server] = {
			server,
			serverName: event.serverName,
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
	/** set subsequent alarms */
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

	if (alarms[line].status !== event.details.status) {
		_alerts[server].alarms[line] = {
			...alarms[line],
			status: event.details.status,
			notified: false,
			endStamp: Date.now(),
		}
		_changed = true
	}
	/** if the status is the same, we don't need to update the state */
	/** deletion handled after "OK" notification sent */
}

/** cronjob function to report alert changes */
export const alertStateCronjob = () => {
	if (process.env.NODE_ENV !== 'test') {
		console.debug(alertStateCronjob.name, 'running cronjob...', { _changed, 'alarmsInAlert': _alerts.size })
	}

	if (!_changed) return
	_changed = false

	let earliestStart = Date.now().valueOf() //for pagerduty alert

	for (const [server, state] of Object.entries(_alerts)) {
		const { serverName, alarms } = state
		/** server message head */
		let serverMsg = `${serverName ? serverName + ' ' : ''}\`${server}\` ${new Date().toUTCString()}\n`

		for (const [line, details] of Object.entries(alarms)) {
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
				serverMsg += createServerLine()
				if (status === 'ok') {
					delete alarms[line]
					if (Object.keys(alarms).length === 0) {
						delete _alerts[server] //N.B. NEED TO BE REALLY CAREFUL WITH THIS!
					}
				} else { /* status === 'alarm */
					alarms[line].notified = true
				}
			}

		}//for alarms
		_slackLoggerNoFormatting(serverMsg, process.env.SLACK_PROBE) //print per server
		if (Date.now() - earliestStart > 600_000) {
			// pagerdutyAlert(serverMsg, serverName || server)
		}
	}//for _alerts

}
/** exported for test only */
export const _slackLoggerNoFormatting = (text: string, hook?: string) => {
	if (hook) {
		fetch(hook, { method: 'POST', body: JSON.stringify({ text }) })
			.then(res => res.text()).then(t => console.log(_slackLoggerNoFormatting.name, `response: ${t}`)) //use up stream to close connection
	} else {
		console.log(_slackLoggerNoFormatting.name, '\n', text)
	}
}

/** *** USED ONLY IN TEST! *** reset server alert state */
export const _resetAlertState = () => {
	Object.keys(_alerts).forEach(key => delete _alerts[key])
	_changed = false
}
