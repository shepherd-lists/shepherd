import 'dotenv/config'
import { handler } from '../lambdas/fnInitLists/index'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test'
import { s3HeadObject } from '../libs/utils/s3-services'
import { processAddonTable } from '../lambdas/fnInitLists/table-processing'
import pg from '../libs/utils/pgClient'
import { ByteRange } from '../libs/s3-lists/merge-ranges';


describe('fnLists tests', () => {

	// it('should process all lists into s3-lists', async () => {
	/**  better just running fnList in aws-console in dev	 */


	it(`should test i/o to ${processAddonTable.name} function`, async () => {
		await pg.query('DROP TABLE IF EXISTS test_txs')
		await pg.query('CREATE TABLE test_txs (txid CHAR(43), flagged BOOLEAN, byte_start BIGINT, byte_end BIGINT)')
		try {
			const fakeIds = ['fake-id-1', 'fake-id-2'].map(s => s.padEnd(43, '_'))
			await pg.query('INSERT INTO test_txs (txid, flagged, byte_start, bytes_end) VALUES ($1, true, 1, 2), ($2, false, 3, 4)', fakeIds)
			console.debug((await pg.query('select * from test_txs')).rows)
			const ranges: ByteRange[] = []

			const count = await processAddonTable({
				tablename: 'test_txs',
				highWaterMark: 200,
				ranges,
				LISTS_BUCKET: process.env.LISTS_BUCKET!,
			})

			// console.debug({ ranges })
			assert.deepEqual(ranges, [[1, 2]])

		} finally {
			await pg.query('DROP TABLE test_txs')
		}
	})

	after(async () => {
		await pg.end()
		// this is dirty, we leave s3 folder `test/*` behind
	})

})