/** -= Unresponsive Servers =- */


import { Http_Api_Node } from '../../../libs/utils/update-range-nodes'


interface Unreachable extends Http_Api_Node {
	since: number
}
const timeout = 300_000 // 5 minutes
const _unreachable = new Map<string, Unreachable>()

export const isUnreachable = (server: string) => {
	return _unreachable.has(server)
}
export const setUnreachable = (item: Http_Api_Node) => {
	_unreachable.set(item.server, { ...item, since: Date.now() })
}

export const deleteUnreachable = (server: string) => {
	return _unreachable.delete(server)
}

export const unreachableTimedout = (server: string) => {
	if (!_unreachable.has(server)) return true //if called on reachable server

	const now = Date.now()
	const stored = _unreachable.get(server)!
	const last = stored.since

	if ((now - last) > timeout) {
		_unreachable.delete(server)
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
