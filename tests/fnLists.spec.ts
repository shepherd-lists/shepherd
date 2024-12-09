import 'dotenv/config'
import { handler } from '../lambdas/fnLists/index'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test'
import { s3HeadObject } from '../libs/utils/s3-services'
import { processAddonTable } from '../lambdas/fnLists/table-processing'
import pg from '../libs/utils/pgClient'
import { ByteRange } from '../libs/s3-lists/merge-ranges';


describe('fnLists tests', () => {

	it('should process all lists into s3-lists', async () => {
		/**
		 * BE CAREFUL! THIS ACTUALLY RUNS THE HANDLER AND OVERWRITES S3 LISTS
		 * check .env file
		 */
		const event = {
			test: "testing"
		}
		const result = await handler(event)

		assert.ok(result, 'should have a result')
		assert.ok(result > 0, 'should have a result greater than zero')

		const s3lists = [
			'txidflagged.txt',
			'txidowners.txt',
			'rangelist.txt',
			'rangeflagged.txt',
			'rangeowners.txt',
		]
		try {
			for (const Key of s3lists) {
				await s3HeadObject(process.env.LISTS_BUCKET!, Key)
			}
			assert.ok(true, 'should have all s3lists')
		} catch (e) {
			assert.fail((e as Error).message)
		}
	})

	it(`should test i/o to ${processAddonTable.name} function`, async () => {
		await pg.query('DROP TABLE IF EXISTS test_txs')
		await pg.query('CREATE TABLE test_txs (txid CHAR(43), flagged BOOLEAN, "byteStart" BIGINT, "byteEnd" BIGINT)')
		try {
			const fakeIds = ['fake-id-1', 'fake-id-2'].map(s => s.padEnd(43, '_'))
			await pg.query('INSERT INTO test_txs (txid, flagged, "byteStart", "byteEnd") VALUES ($1, true, 1, 2), ($2, false, 3, 4)', fakeIds)
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