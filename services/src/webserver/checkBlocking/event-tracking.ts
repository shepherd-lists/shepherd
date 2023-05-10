/** -= Unresponsive Servers =- */

import { slackLogger } from "../../common/utils/slackLogger"

const timeout = 300_000 // 5 minutes
const _unreachable = new Map<string, number>()

export const unreachableTimedout = (server: string) => {
	const now = Date.now()
	const noResponse = _unreachable.get(server)

	/** maybe the following is unreadable.. it's a terse form of:
	 * if(!noResponse){
	 * 		_unreachable.set(server, now)
	 * 		return false;
	 * }
	 * if((now - noResponse) > timeout){
	 * 		_unreachable.set(server, now)
	 * 		return true;
	 * }
	 */
	if(!noResponse || (now - noResponse) > timeout){
		_unreachable.set(server, now)
		return !!noResponse;
	}
	return false;
}

export const unreachableReset = (server: string) => {
	return _unreachable.delete(server)
}

/** -= track start/end of not-block events =- */

export interface NotBlockEvent {
	server: string
	item: string
	status: ('alarm'|'ok')
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
		const {server, item, status, notified, start, end} = state
		if(!notified){
			if(status === 'alarm'){
				msg += `🔴 ALARM ${server}, ${item}, started:${new Date(start).toUTCString()}\n`
			}
			if(state.status === 'ok'){
				msg += `🟢 OK Not blocked for ${((end!-start)/60_000).toFixed(1)} minutes, ${server}, ${item}, `
				msg += `started:${new Date(start).toUTCString()}, ended:${new Date(end!).toUTCString()}\n`

				_serversInAlert.delete(key)
			}else{
				_serversInAlert.set(key, {...state, notified: true})
			}
		}
	}
	slackLogger(msg)
}