/** -= Unresponsive Servers =- */

import { logger } from '../../common/shepherd-plugin-interfaces/logger'
import { RangelistAllowedItem } from '../webserver-types'

interface Unreachable extends RangelistAllowedItem {
	since: number
}
const timeout = 300_000 // 5 minutes
const _unreachable = new Map<string, Unreachable>()

export const isUnreachable = (server: string) => {
	return _unreachable.has(server)
}
export const setUnreachable = (item: RangelistAllowedItem) => {
	_unreachable.set(item.server, { ...item, since: Date.now() })
}

export const deleteUnreachable = (server: string) => {
	return _unreachable.delete(server)
}

export const unreachableTimedout = (server: string) => {
	if(!_unreachable.has(server)) return true //if called on reachable server

	const now = Date.now()
	const stored = _unreachable.get(server)!
	const last = stored.since

	if((now - last) > timeout){
		_unreachable.set(server, {...stored, since: now})
		return true
	}
	return false
}

export const unreachableServers = () => {
	return {
		number: _unreachable.size,
		keys: [..._unreachable.keys()],
		names: [..._unreachable.values()].map(item => item.name)
	}
}

/** -= track start/end of not-block events =- */

interface NotBlockEventDetails {
	xtrace: string
	age: string
	contentLength: string
	httpStatus: number
	endpointType: '/TXID' | '/chunk'
}
export interface NotBlockEvent {
	server: RangelistAllowedItem
	item: string
	status: ('alarm'|'ok')
	details?: NotBlockEventDetails
}
interface NotBlockState extends NotBlockEvent {
	start: number
	end?: number
	notified: boolean
}
const _alarmsInAlert = new Map<string, NotBlockState>()
let _changed = false

export const alarmsInAlert = () => {
	return {
		number: _alarmsInAlert.size,
		list: [..._alarmsInAlert.values()],
	}
}

export const setAlertState = (event: NotBlockEvent) => {
	const key = `${event.server.server},${event.item}`
	if(!_alarmsInAlert.has(key)){
		if(event.status === 'ok') return //only add new alarm events
		_alarmsInAlert.set(key, {
			...event,
			start: Date.now(),
			notified: false
		})
		_changed = true
	}
	const state = _alarmsInAlert.get(key)!
	if(state.status !== event.status){
		_alarmsInAlert.set(key, {
			...state,
			status: event.status,
			notified: false,
			end: Date.now(),
		})
		_changed = true
	}
	/** if the status is the same, we don't need to update the state */
}

/** cronjob function to report alert changes */
export const alertStateCronjob = () => {
	if(process.env.NODE_ENV !== 'test'){
		logger(alertStateCronjob.name, 'running cronjob...', {_changed, 'alarmsInAlert': _alarmsInAlert.size})
	}

	if(!_changed) return
	_changed = false

	let msg = ''

	for(const [key, state] of _alarmsInAlert){
		const {server, item, status, notified, start, end, details} = state
		if(!notified){
			if(status === 'alarm'){
				msg += `🔴 ALARM ${server.name} \`${server.server}\`, \`${details?.endpointType}\` started:"${new Date(start).toUTCString()}". x-trace:${details?.xtrace}, age:${details?.age}, `
				msg += `http-status:${details?.httpStatus}, content-length:${details?.contentLength}\n`
			}
			if(state.status === 'ok'){
				msg += `🟢 OK, was not blocked for ${((end!-start)/60_000).toFixed(1)} minutes, ${server.name} \`${server.server}\`, \`${details?.endpointType}\` x-trace: ${details?.xtrace}, `
				msg += `started:"${new Date(start).toUTCString()}", ended:"${new Date(end!).toUTCString()}"\n`

				_alarmsInAlert.delete(key)
			}else{
				_alarmsInAlert.set(key, {...state, notified: true})
			}
		}
	}
	_slackLoggerNoFormatting(msg, process.env.SLACK_PROBE)
}
/** exported for test only */
export const _slackLoggerNoFormatting = (text: string, hook?: string) => {
	if(hook){
		fetch(hook, { method: 'POST', body: JSON.stringify({ text })})
			.then(res => res.text()).then(t => console.log(_slackLoggerNoFormatting.name,`response: ${t}`)) //use up stream to close connection
	}else{
		console.log(_slackLoggerNoFormatting.name, '\n', text)
	}
}

/** *** USED ONLY IN TEST! *** reset server alert state */
export const _resetAlertState = () => {
	_alarmsInAlert.clear()
	_changed = false
}
