import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test'
import pg, { batchInsert, batchUpsertTxsWithRules } from '../libs/utils/pgClient'
import { TxRecord } from 'shepherd-plugin-interfaces/types';



describe('pgClient tests', () => {

	after(async () => {
		await pg.end()
	})

	it('should insert txs with merge rules', async () => {
		const testTxs: Partial<TxRecord>[] = [
			{ txid: '1'.padEnd(43, '-'), flagged: true, byte_start: '1', byte_end: '2', content_type: 'test', content_size: '0' },
			{ txid: '2'.padEnd(43, '-'), flagged: false, byte_start: '3', byte_end: '4', content_type: 'test', content_size: '0' },
			{ txid: '3'.padEnd(43, '-'), flagged: false, byte_start: '-1', byte_end: '-1', content_type: 'test', content_size: '0' },
			//@ts-expect-error flagged: null
			{ txid: 'unchanged'.padEnd(43, '-'), flagged: null, byte_start: '-1', byte_end: '-1', content_type: 'test', content_size: '0' },
		]

		try {
			await pg.query('BEGIN')

			/** test records to merge into */
			const initialise = await batchInsert(testTxs, 'txs')
			assert.equal(initialise, testTxs.length, 'error initialising txs')

			/** attempt updates to those test records */
			testTxs[0].flagged = false //should be ignored, but will still trigger a merge

			testTxs[1].flagged = true //should update
			testTxs[1].byte_start = '-1' //should be ignored
			testTxs[1].byte_end = '-1' //should be ignored

			testTxs[2].byte_start = '5' //should update
			testTxs[2].byte_end = '6' //should update

			/** merge the updated records */
			const merged = await batchUpsertTxsWithRules(testTxs as TxRecord[], 'txs') as TxRecord[]

			/** check the results */
			// console.debug('merged', JSON.stringify(merged, null, 2))

			const numtoupdate = testTxs.length - 1; //unchanged record should not be updated
			assert.equal(merged.length, numtoupdate, 'error merging txs')

			assert.equal(merged[0].flagged, true, 'truthy flagged should be preserved')
			assert.equal(merged[0].byte_start, '1', 'byte_start should be preserved') //sanity
			assert.equal(merged[0].byte_end, '2', 'byte_end should be preserved') //sanity


			assert.equal(merged[1].flagged, true, 'false flagged should be updated to true')
			assert.equal(merged[1].byte_start, '3', 'byte_start should not be overwritten by bad values')
			assert.equal(merged[1].byte_end, '4', 'byte_end should not be overwritten by bad values')

			assert.equal(merged[2].byte_start, '5', 'byte_start should be updated')
			assert.equal(merged[2].byte_end, '6', 'byte_end should be updated')


		} catch (e) {
			assert.fail(String(e))
		}
		finally {
			await pg.query('ROLLBACK') //always rollback tests
		}

	})


})