import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { addonHandler } from '../services/http-api/src/addonHandler'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import knexCreate from '../libs/utils/knexCreate';

const knex = knexCreate()

describe('addonHandler', () => {
	const mockRecord: Partial<TxRecord> = {
		txid: 'test-txid'.padEnd(43, '-'),
		content_type: 'text/plain',
		content_size: '123',
		height: 123,
		// parent: null,
		// parents: undefined,
		// owner: null,
		flagged: true,
		valid_data: true,
		// data_reason: 'unsupported',
		// byte_start: undefined,
		// byte_end: undefined,
		// last_update_date: new Date(),
		// flag_type: undefined,
		// top_score_name: undefined,
		// top_score_value: undefined
	}

	after(async () => {
		await knex.destroy()
	})

	it('should validate input correctly', async () => {
		// Test empty addonPrefix
		try {
			await addonHandler({
				addonPrefix: '',
				records: [mockRecord as TxRecord]
			})
			assert.fail('Should have thrown error for empty addonPrefix')
		} catch (e) {
			assert.ok(e instanceof Error)
			assert.ok(e.message.includes('addonPrefix'))
		}

		// Test too many records
		const manyRecords = Array(101).fill(mockRecord)
		try {
			await addonHandler({
				addonPrefix: 'test',
				records: manyRecords
			})
			assert.fail('Should have thrown error for too many records')
		} catch (e) {
			assert.ok(e instanceof Error)
			assert.ok(e.message.includes('Maximum 100 records'))
		}

		// Test bad record (missing required fields)
		try {
			await addonHandler({
				addonPrefix: 'test',
				records: [{ txid: 'test-txid-bad-record'.padEnd(43, '-') } as TxRecord]
			})
			assert.fail('Should have thrown error for bad record')
		} catch (e) {
			assert.ok(e instanceof Error)
			assert.ok(e.message.includes('Invalid arguments'))
		}
	})


	it('should validate correct input', async () => {
		//PLACEHOLDER
		const result = await addonHandler({
			addonPrefix: 'test',
			records: [mockRecord as TxRecord]
		})
		assert.strictEqual(result, undefined)
	})



})


