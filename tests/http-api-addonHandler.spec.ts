import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
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

	before(async () => {
		await knex.raw('CREATE TABLE IF NOT EXISTS tests_txs (txid VARCHAR(43) PRIMARY KEY, content_type VARCHAR(255) NOT NULL, content_size INT NOT NULL, height INT NOT NULL, flagged BOOLEAN, valid_data BOOLEAN, data_reason VARCHAR(255), byte_start VARCHAR(255), byte_end VARCHAR(255), last_update_date TIMESTAMP, flag_type VARCHAR(255), top_score_name VARCHAR(255), top_score_value FLOAT)')
	})

	after(async () => {
		await knex.raw('DROP TABLE IF EXISTS tests_txs')
		await knex.destroy()
	})

	it('should invalidate incorrect input', async () => {
		//test empty addonPrefix
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

		//test too many records
		const manyRecords = Array(101).fill(mockRecord)
		try {
			await addonHandler({
				addonPrefix: 'tests',
				records: manyRecords
			})
			assert.fail('Should have thrown error for too many records')
		} catch (e) {
			assert.ok(e instanceof Error)
			assert.ok(e.message.includes('Maximum 100 records'))
		}

		//test bad record (missing required content fields)
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


	it('should process correct input', async () => {
		const insertCount = await addonHandler({
			addonPrefix: 'tests',
			records: [mockRecord as TxRecord]
		}, async (txid, parent, parents) => ({ start: 1n, end: 2n })
		)
		assert.equal(insertCount, 1)
	})



})


