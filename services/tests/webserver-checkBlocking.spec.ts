process.env.NODE_ENV = 'test'
/** required env vars for tests */
const GW = 'https://example.org'
process.env.GW_URLS = `["${GW}"]`
process.env.BLACKLIST_ALLOWED = '["1.1.1.1", "127.0.0.1"]'
process.env.RANGELIST_ALLOWED = '["1.1.1.1", "127.0.0.1"]'
import * as CheckBlocking from '../src/webserver/checkBlocking/checkBlocking-functions'
import * as Fetch from '../src/webserver/checkBlocking/fetch-checkBlocking'
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
		await CheckBlocking.checkBlockedCronjob()

		//inspect test results
		expect(getBlacklist_stub.calledOnce, `getBlacklist_stub called more than once`).true
		expect(getRangelist_stub.calledOnce, `getRangelist_stub called more than once`).true
		// console.log(JSON.stringify(checkBlocked_stub.getCalls().map(call => call.args), null, 2	))
		expect(checkBlocked_stub.callCount, `checkBlocked_stub gets called for every combination`).eq(12)

		expect(checkBlocked_stub.calledWithExactly(`${GW}/blacklist-entry-1`, 'blacklist-entry-1', GW))
		expect(checkBlocked_stub.calledWithExactly(`${GW}/blacklist-entry-2`, 'blacklist-entry-2', GW))
		expect(checkBlocked_stub.calledWithExactly(`${GW}/blacklist-entry-3`, 'blacklist-entry-3', GW))

		expect(checkBlocked_stub.calledWithExactly('http://127.0.0.1:1984/chunk/' + 'range1', 'range1', 'range1,range1'))
		expect(checkBlocked_stub.calledWithExactly('http://1.1.1.1:1984/chunk/' + 'range1', 'range1', 'range1,range1'))
		expect(checkBlocked_stub.calledWithExactly('https://example.org/chunk/' + 'range1', 'range1', 'range1,range1'))
		expect(checkBlocked_stub.calledWithExactly('http://127.0.0.1:1984/chunk/' + 'range2', 'range2', 'range2,range2'))
		expect(checkBlocked_stub.calledWithExactly('http://1.1.1.1:1984/chunk/' + 'range2', 'range2', 'range2,range2'))
		expect(checkBlocked_stub.calledWithExactly('https://example.org/chunk/' + 'range2', 'range2', 'range2,range2'))
		expect(checkBlocked_stub.calledWithExactly('http://127.0.0.1:1984/chunk/' + 'range3', 'range3', 'range3,range3'))
		expect(checkBlocked_stub.calledWithExactly('http://1.1.1.1:1984/chunk/' + 'range3', 'range3', 'range3,range3'))
		expect(checkBlocked_stub.calledWithExactly('https://example.org/chunk/' + 'range3', 'range3', 'range3,range3'))


	}).timeout(0)

	it(`checkBlocked should run without error`, async()=> {
		//@ts-ignore
		const fetch_checkBlocking_stub = sinon.stub(Fetch, 'fetch_checkBlocking').resolves({ aborter: null, res: { status: 404, statusText: '404 message', headers: new Headers() }})
		await CheckBlocking.checkBlocked(`http://fake.url/path/route`, 'item-name', 'http://fake.url')

		expect(fetch_checkBlocking_stub.calledWithExactly(`http://fake.url/path/route`))

	}).timeout(0)

	it(`checkBlocked should output json logs when not-blocked`, async()=> {
		//@ts-ignore
		const fetch_checkBlocking_stub = sinon.stub(Fetch, 'fetch_checkBlocking').resolves({ aborter: null, res: { status: 200, statusText: 'ok', headers: new Headers() }})
		await CheckBlocking.checkBlocked(`http://fake.url/path/route`, 'item-name', 'http://fake.url')

		expect(fetch_checkBlocking_stub.calledWithExactly(`http://fake.url/path/route`))

	}).timeout(0)
})
