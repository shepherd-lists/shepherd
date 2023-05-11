/** -= Unresponsive Servers =- */

import { slackLogger } from "../../common/utils/slackLogger"

const timeout = 300_000 // 5 minutes
const _unreachable = new Map<string, number>()

export const isUnreachable = (server: string) => {
	return _unreachable.has(server)
}
export const setUnreachable = (server: string) => {
	_unreachable.set(server, Date.now())
}

export const deleteUnreachable = (server: string) => {
	return _unreachable.delete(server)
}

export const unreachableTimedout = (server: string) => {
	if(!_unreachable.has(server)) return true //if called on reachable server

	const now = Date.now()
	const last = _unreachable.get(server)!

	if((now - last) > timeout){
		_unreachable.set(server, now)
		return true;
	}
	return false;
}

/** -= track start/end of not-block events =- */

interface NotBlockEventDetails {
	xtrace: string
	age: string
	contentLength: string
	httpStatus: number
}
export interface NotBlockEvent {
	server: string
	item: string
	status: ('alarm'|'ok')
	details?: NotBlockEventDetails
}
interface NotBlockState extends NotBlockEvent {
	start: number
	end?: number
	notified: boolean
}
const _serversInAlert = new Map<string, NotBlockState>()
let _changed = false

export const setAlertState = (event: NotBlockEvent) => {
	const key = `${event.server},${event.item}`
	if(!_serversInAlert.has(key)){
		_serversInAlert.set(key, {
			...event,
			start: Date.now(),
			notified: false
		})
		_changed = true
	}
	const state = _serversInAlert.get(key)!
	if(state.status !== event.status){
		_serversInAlert.set(key, {
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
	if(!_changed) return;
	_changed = false

	let msg = ''
	type header = '🟢 OK'|'🔴 ALARM'

	for(const [key, state] of _serversInAlert){
		const {server, item, status, notified, start, end, details} = state
		if(!notified){
			if(status === 'alarm'){
				msg += `🔴 ALARM ${server}, started:"${new Date(start).toUTCString()}". x-trace:${details?.xtrace}, age:${details?.age}, `
				msg += `http-status:${details?.httpStatus}, content-length:${details?.contentLength}\n`
			}
			if(state.status === 'ok'){
				msg += `🟢 OK, was not blocked for ${((end!-start)/60_000).toFixed(1)} minutes, ${server}, x-trace:${details?.xtrace}, `
				msg += `started:"${new Date(start).toUTCString()}", ended:"${new Date(end!).toUTCString()}"\n`

				_serversInAlert.delete(key)
			}else{
				_serversInAlert.set(key, {...state, notified: true})
			}
		}
	}
	slackLogger(msg)
}