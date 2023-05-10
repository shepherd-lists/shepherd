import 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { alertStateCronjob, setAlertState, unreachableReset, unreachableTimedout } from '../src/webserver/checkBlocking/event-tracking'
import * as Logger from '../src/common/utils/slackLogger'

const timeout = 300_000 // 5 minutes
let counter = 123 //arbitrary starting point
const fakeTime = ()=> counter += (timeout/2 + 1)

describe(`event-tracking tests`, () => {

	afterEach(() => {
		sinon.restore()
	})

	it('should test various unreachable server scenarios', async () => {
		const nowStub = sinon.stub(Date, 'now').callsFake(fakeTime) //every call adds 2.5+ mins

		const server = 'https://example.com'
		
		//add server
		let res = unreachableTimedout(server)
		expect(res, 'add server for first time').to.be.false
		expect(nowStub.callCount).to.equal(1)

		//server should not have timed out yet
		res = unreachableTimedout(server) 
		expect(res, 'server should not be timed out').to.be.false

		//server should have timed out
		res = unreachableTimedout(server)
		expect(res, 'timed out for server').to.be.true

		//test it goes through the timeout cycle again
		res = unreachableTimedout(server)
		expect(res).to.be.false
		res = unreachableTimedout(server)
		expect(res).to.be.true

		//delete server
		const reset = unreachableReset(server)
		expect(reset).to.be.true
		//should add server again
		res = unreachableTimedout(server)
		expect(res).to.be.false 
	})

	it('should test output messages of alertStageCronjob', async()=> {
		const loggerStub = sinon.stub(Logger, 'slackLogger')
		const nowStub = sinon.stub(Date, 'now').callsFake(fakeTime) //every call adds 2.5+ mins
		
		const server = 'https://example.com'
		const server2 = '1.1.1.1'
		const item = 'test-id-1-test-id-1-test-id-1-test-id-1-123'

		alertStateCronjob() //should not log anything
		let loggerCount = 0
		expect(loggerStub.callCount, 'first cronjob should not call logger').to.equal(loggerCount)

		setAlertState({server, item, status: 'alarm'})

		alertStateCronjob() //should log alarm
		expect(loggerStub.callCount, 'second cronjob should output to logger').to.equal(++loggerCount)
		expect(loggerStub.getCall(0).args[0]).eq(
			'🔴 ALARM https://example.com, test-id-1-test-id-1-test-id-1-test-id-1-123, started:Thu, 01 Jan 1970 00:17:30 GMT\n'
		)

		setAlertState({server, item, status: 'ok'})
		setAlertState({server: server2, item, status: 'alarm'})
		expect(nowStub.callCount).to.equal(3)

		alertStateCronjob() //should log 1 alarm and 1 ok
		expect(loggerStub.callCount, 'third cronjob should output to logger').to.equal(++loggerCount)
		expect(loggerStub.getCall(1).args[0]).eq(
`🟢 OK Not blocked for 2.5 minutes, https://example.com, test-id-1-test-id-1-test-id-1-test-id-1-123, started:Thu, 01 Jan 1970 00:17:30 GMT, ended:Thu, 01 Jan 1970 00:20:00 GMT
🔴 ALARM 1.1.1.1, test-id-1-test-id-1-test-id-1-test-id-1-123, started:Thu, 01 Jan 1970 00:22:30 GMT
`			
		)

		alertStateCronjob() //should log nothing (1 alarm already	logged)
		expect(loggerStub.callCount, 'fourth cronjob should output nothing').to.equal(loggerCount)

		setAlertState({server: server2, item, status: 'ok'})
		alertStateCronjob() //should log 1 ok
		expect(loggerStub.callCount, 'fifth cronjob should output to logger').to.equal(++loggerCount)
		expect(loggerStub.getCall(2).args[0]).eq(
`🟢 OK Not blocked for 2.5 minutes, 1.1.1.1, test-id-1-test-id-1-test-id-1-test-id-1-123, started:Thu, 01 Jan 1970 00:22:30 GMT, ended:Thu, 01 Jan 1970 00:25:00 GMT
`
		)

		alertStateCronjob() //should log nothing
		expect(loggerStub.callCount, 'sixth cronjob should output nothing').to.equal(loggerCount)


	})

})