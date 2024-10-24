import 'dotenv/config'
import { handler } from '../lambdas/fnLists/index'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test'
import { s3HeadObject } from '../libs/utils/s3-services'


describe('fnLists tests', () => {

	it('should process all lists into s3-lists', async () => {
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

})