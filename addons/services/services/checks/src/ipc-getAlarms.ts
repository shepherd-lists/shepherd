import { MessageType } from '.'
import { NotBlockStateDetails } from './event-tracking'
import { randomUUID } from 'crypto'


type PendingRequest = {
	resolve: (value: any) => void
	reject: (reason?: any) => void //remove?
}

const _pendingRequests: { [reqid: string]: PendingRequest } = {}

/** process received messages from main */
process.on('message', (message: MessageType) => {
	// console.debug('[ranges] received', JSON.stringify(message))
	if (message.type === 'returnAlarms' && _pendingRequests[message.reqid]) {
		_pendingRequests[message.reqid].resolve(message.alarms)
		delete _pendingRequests[message.reqid]
	}
})

// const _serverAlarmRequestQ: { [reqid: string]: { [line: string]: NotBlockStateDetails } } = {}
export const getServerAlarmsIPC = (server: string): Promise<{ [line: string]: NotBlockStateDetails }> => {
	return new Promise((resolve, reject) => {
		const reqid = randomUUID()
		_pendingRequests[reqid] = { resolve, reject } //this will hold the response
		process.send!(<MessageType>{ type: 'getServerAlarms', server, reqid })
	})
}

