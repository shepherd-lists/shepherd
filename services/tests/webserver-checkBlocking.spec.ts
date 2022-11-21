process.env.NODE_ENV = 'test'
/** required env vars for tests */
process.env.GW_URLS = '["https://example.org"]'
process.env.BLACKLIST_ALLOWED = '["1.1.1.1", "127.0.0.1"]'
process.env.RANGELIST_ALLOWED = '["1.1.1.1", "127.0.0.1"]'
import * as CheckBlocking from '../src/webserver/checkBlocking-functions'
import * as Blacklist from '../src/webserver/blacklist'
import 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'



describe(`checkBlocking tests`, () => {

	afterEach(() => sinon.restore())

	it(`tests whether lists get traversed`, async () => {
		//prepare stubs
		const checkBlocked_stub = sinon.stub(CheckBlocking, "checkBlocked").resolves()
		const getBlacklist_stub = sinon.stub(Blacklist, 'getBlacklist').callsFake(async (res) =>
			res.write('blacklist-entry-1\nblacklist-entry-2\nblacklist-entry-3\n')
		)
		const getRangelist_stub = sinon.stub(Blacklist, 'getRangelist').callsFake(async (res) =>
			res.write('range1,range1\nrange2,range2\nrange3,range3\n')
		)

		//run actual test
		await CheckBlocking.streamLists()

		//inspect test results
		expect(getBlacklist_stub.calledOnce, `getBlacklist_stub called more than once`).true
		expect(getRangelist_stub.calledOnce, `getRangelist_stub called more than once`).true
		expect(checkBlocked_stub.callCount, `checkBlocked_stub gets called for every combination`).eq(9)

		expect(checkBlocked_stub.calledWithExactly('https://example.org/' + 'blacklist-entry-1', 'blacklist-entry-1'))
		expect(checkBlocked_stub.calledWithExactly('https://example.org/' + 'blacklist-entry-2', 'blacklist-entry-2'))
		expect(checkBlocked_stub.calledWithExactly('https://example.org/' + 'blacklist-entry-3', 'blacklist-entry-3'))

		expect(checkBlocked_stub.calledWithExactly('http://127.0.0.1:1984/chunk/' + 'range1', 'range1'))
		expect(checkBlocked_stub.calledWithExactly('https://example.org/chunk/' + 'range1', 'range1'))
		expect(checkBlocked_stub.calledWithExactly('http://127.0.0.1:1984/chunk/' + 'range2', 'range2'))
		expect(checkBlocked_stub.calledWithExactly('https://example.org/chunk/' + 'range2', 'range2'))
		expect(checkBlocked_stub.calledWithExactly('http://127.0.0.1:1984/chunk/' + 'range3', 'range3'))
		expect(checkBlocked_stub.calledWithExactly('https://example.org/chunk/' + 'range3', 'range3'))


	}).timeout(0)
})
