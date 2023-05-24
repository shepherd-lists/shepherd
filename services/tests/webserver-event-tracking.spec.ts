process.env.NODE_ENV = 'test'
import 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { alertStateCronjob, isUnreachable, setAlertState, setUnreachable, deleteUnreachable, unreachableTimedout, _resetAlertState } from '../src/webserver/checkBlocking/event-tracking'
import * as EventTracking from '../src/webserver/checkBlocking/event-tracking'
import { RangelistAllowedItem } from '../src/webserver/webserver-types'

const timeout = 300_000 // 5 minutes
let counter = 123 //arbitrary starting point
const fakeTime = ()=> counter += (timeout/2 + 1)

describe(`event-tracking tests`, () => {

	beforeEach(() => {
		_resetAlertState()
	})

	afterEach(() => {
		sinon.restore()
		counter = 123
	})

	it('should test various unreachable server scenarios', async () => {
		const nowStub = sinon.stub(Date, 'now').callsFake(fakeTime) //every call adds 2.5+ mins

		const server = 'https://example.com'

		let res = isUnreachable(server)
		expect(res, 'server should not be unreachable').false

		//add server
		setUnreachable(server)
		res = unreachableTimedout(server)
		expect(res, 'add server for first time').false
		expect(nowStub.callCount).to.equal(2)

		res = isUnreachable(server)
		expect(res, 'server should be unreachable').true

		//server should have timed out already
		res = unreachableTimedout(server) 
		expect(res, 'server should not be timed out').to.be.true

		//server should be back in timed out
		res = unreachableTimedout(server)
		expect(res, 'should be timed out').to.be.false

		//test it has through the timeout cycle again
		res = unreachableTimedout(server)
		expect(res).to.be.true

		//delete server
		const reset = deleteUnreachable(server)
		expect(reset).to.be.true
		//should be removed
		res = unreachableTimedout(server)
		expect(res).to.be.true 
	})

	it('should test output messages of alertStageCronjob', async()=> {
		const loggerStub = sinon.stub(EventTracking, '_slackLoggerNoFormatting')
		const nowStub = sinon.stub(Date, 'now').callsFake(fakeTime) //every call adds 2.5+ mins
		
		const server: RangelistAllowedItem = {name: 'https://example.com', server: 'https://example.com'}
		const server2: RangelistAllowedItem = {name: 'google-dns', server: '1.1.1.1'}
		const item = 'test-id-1-test-id-1-test-id-1-test-id-1-123'

		alertStateCronjob() //should not log anything
		let loggerCount = 0
		expect(loggerStub.callCount, 'first cronjob should not call logger').to.equal(loggerCount)

		setAlertState({server, item, status: 'alarm', details: {age: '1', contentLength: '2', httpStatus: 200, xtrace: '4', endpointType: '/TXID'}})

		alertStateCronjob() //should log alarm
		expect(loggerStub.callCount, 'second cronjob should output to logger').to.equal(++loggerCount)
		expect(loggerStub.getCall(0).args[0]).eq(
			'🔴 ALARM https://example.com `https://example.com`, `/TXID` started:"Thu, 01 Jan 1970 00:02:30 GMT". x-trace:4, age:1, http-status:200, content-length:2\n'
		)

		setAlertState({server, item, status: 'ok'})
		setAlertState({server: server2, item, status: 'alarm', details: {age: '1', contentLength: '2', httpStatus: 200, xtrace: '4', endpointType: '/chunk'}})
		expect(nowStub.callCount).to.equal(3)

		alertStateCronjob() //should log 1 alarm and 1 ok
		expect(loggerStub.callCount, 'third cronjob should output to logger').to.equal(++loggerCount)
		expect(loggerStub.getCall(1).args[0]).eq(
			'🟢 OK, was not blocked for 2.5 minutes, https://example.com `https://example.com`, `/TXID` x-trace: 4, started:"Thu, 01 Jan 1970 00:02:30 GMT", ended:"Thu, 01 Jan 1970 00:05:00 GMT"\n'
			+ '🔴 ALARM google-dns `1.1.1.1`, `/chunk` started:"Thu, 01 Jan 1970 00:07:30 GMT". x-trace:4, age:1, http-status:200, content-length:2\n'
		)

		alertStateCronjob() //should log nothing (1 alarm already	logged)
		expect(loggerStub.callCount, 'fourth cronjob should output nothing').to.equal(loggerCount)

		setAlertState({server: server2, item, status: 'ok'})
		alertStateCronjob() //should log 1 ok
		expect(loggerStub.callCount, 'fifth cronjob should output to logger').to.equal(++loggerCount)
		expect(loggerStub.getCall(2).args[0]).eq(
			'🟢 OK, was not blocked for 2.5 minutes, google-dns `1.1.1.1`, `/chunk` x-trace: 4, started:"Thu, 01 Jan 1970 00:07:30 GMT", ended:"Thu, 01 Jan 1970 00:10:00 GMT"\n'
		)

		alertStateCronjob() //should log nothing
		expect(loggerStub.callCount, 'sixth cronjob should output nothing').to.equal(loggerCount)


	})

})