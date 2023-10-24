/** required env vars for tests */
const GW = 'https://example.org'
process.env.GW_URLS = `["${GW}"]`
process.env.BLACKLIST_ALLOWED = '["1.1.1.1", "127.0.0.1"]'
const blackYes = JSON.parse(process.env.BLACKLIST_ALLOWED)
process.env.RANGELIST_ALLOWED = '[{"name":"server1","server":"1.1.1.1"},{"name":"server2","server":"2.2.2.2"}]'
const rangeYes: RangelistAllowedItem[] = JSON.parse(process.env.RANGELIST_ALLOWED)

import * as CheckBlocking from '../src/webserver/checkBlocking/checkBlocking-functions'
import * as Fetch from '../src/webserver/checkBlocking/fetch-checkBlocking'
import * as Blacklist from '../src/webserver/blacklist'
import 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { RangelistAllowedItem } from '../src/webserver/webserver-types'



describe('checkBlocking tests', () => {

	afterEach(() => sinon.restore())

	it('tests whether lists get traversed', async () => {
		//prepare stubs
		const checkBlocked_stub = sinon.stub(CheckBlocking, 'checkBlocked').resolves()
		const getBlacklist_stub = sinon.stub(Blacklist, 'getBlacklist').callsFake(async (res) =>
			res.write('blacklist-entry-1\nblacklist-entry-2\nblacklist-entry-3\n')
		)
		const getRangelist_stub = sinon.stub(Blacklist, 'getRangelist').callsFake(async (res) =>
			res.write('range1,range1\nrange2,range2\nrange3,range3\n')
		)

		//run actual test
		await CheckBlocking.checkBlockedCronjob()

		//inspect test results
		expect(getBlacklist_stub.calledOnce, 'getBlacklist_stub called more than once').true
		expect(getRangelist_stub.calledOnce, 'getRangelist_stub called more than once').true
		// console.log(JSON.stringify(checkBlocked_stub.getCalls().map(call => call.args), null, 2	))
		expect(checkBlocked_stub.callCount, 'checkBlocked_stub gets called for every combination').eq(12)

		expect(checkBlocked_stub.calledWithExactly(`${GW}/blacklist-entry-1`, 'blacklist-entry-1', {name: GW, server: GW}))
		expect(checkBlocked_stub.calledWithExactly(`${GW}/blacklist-entry-2`, 'blacklist-entry-2', {name: GW, server: GW}))
		expect(checkBlocked_stub.calledWithExactly(`${GW}/blacklist-entry-3`, 'blacklist-entry-3', {name: GW, server: GW}))

		expect(checkBlocked_stub.calledWithExactly(`${GW}/chunk/range1`, 'range1,range1', {name: GW, server: GW}))
		expect(checkBlocked_stub.calledWithExactly(`http://${rangeYes[0].server}:1984/chunk/range1`, 'range1,range1', rangeYes[0]))
		expect(checkBlocked_stub.calledWithExactly(`http://${rangeYes[1].server}:1984/chunk/range1`, 'range1,range1', rangeYes[1]))

		expect(checkBlocked_stub.calledWithExactly(`${GW}/chunk/range2`, 'range2,range2', {name: GW, server: GW}))
		expect(checkBlocked_stub.calledWithExactly(`http://${rangeYes[0].server}:1984/chunk/range2`, 'range2,range2', rangeYes[0]))
		expect(checkBlocked_stub.calledWithExactly(`http://${rangeYes[1].server}:1984/chunk/range2`, 'range2,range2', rangeYes[1]))

		expect(checkBlocked_stub.calledWithExactly(`${GW}/chunk/range3`, 'range3,range3', {name: GW, server: GW}))
		expect(checkBlocked_stub.calledWithExactly(`http://${rangeYes[0].server}:1984/chunk/range3`, 'range3,range3', rangeYes[0]))
		expect(checkBlocked_stub.calledWithExactly(`http://${rangeYes[1].server}:1984/chunk/range3`, 'range3,range3', rangeYes[1]))

	}).timeout(0)

	it('checkBlocked should run without error', async()=> {
		//@ts-ignore
		const fetch_checkBlocking_stub = sinon.stub(Fetch, 'fetch_checkBlocking').resolves({ aborter: null, res: { status: 404, statusText: '404 message', headers: new Headers() }})
		await CheckBlocking.checkBlocked('http://fake.url/path/route', 'item-name', {name:'fake-url', server: 'http://fake.url'})

		expect(fetch_checkBlocking_stub.calledWithExactly('http://fake.url/path/route'))

	}).timeout(0)

	it('checkBlocked should output json logs when not-blocked', async()=> {
		//@ts-ignore
		const fetch_checkBlocking_stub = sinon.stub(Fetch, 'fetch_checkBlocking').resolves({ aborter: null, res: { status: 200, statusText: 'ok', headers: new Headers() }})
		await CheckBlocking.checkBlocked('http://fake.url/path/route', 'item-name', {name:'fake-url', server: 'http://fake.url'})

		expect(fetch_checkBlocking_stub.calledWithExactly('http://fake.url/path/route'))

	}).timeout(0)
})
