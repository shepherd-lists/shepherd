import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import { addonHandler } from '../services/http-api/src/addonHandler'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import knexCreate from '../libs/utils/knexCreate';
import { s3DeleteFolder } from '../libs/utils/s3-services';

const knex = knexCreate()

describe('addonHandler', () => {

	const addonPrefix = 'tests'

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
		await knex.raw(`CREATE TABLE IF NOT EXISTS ${addonPrefix}_txs (txid VARCHAR(43) PRIMARY KEY, content_type VARCHAR(255) NOT NULL, content_size INT NOT NULL, height INT NOT NULL, flagged BOOLEAN, valid_data BOOLEAN, data_reason VARCHAR(255), byte_start VARCHAR(255), byte_end VARCHAR(255), last_update_date TIMESTAMP, flag_type VARCHAR(255), top_score_name VARCHAR(255), top_score_value FLOAT)`)
	})

	after(async () => {
		await knex.raw(`DROP TABLE IF EXISTS ${addonPrefix}_txs`)
		await knex.destroy()
		await s3DeleteFolder(process.env.LISTS_BUCKET!, `${addonPrefix}/`)
	})

	it('should invalidate incorrect input', async () => {
		/** test empty addonPrefix */
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

		/** test too many records */
		const manyRecords = Array(101).fill(mockRecord)
		try {
			await addonHandler({
				addonPrefix,
				records: manyRecords
			})
			assert.fail('Should have thrown error for too many records')
		} catch (e) {
			assert.ok(e instanceof Error)
			assert.ok(e.message.includes('Maximum 100 records'))
		}

		/** test bad record (missing required content fields) */
		try {
			await addonHandler({
				addonPrefix,
				records: [{ txid: 'test-txid-bad-record'.padEnd(43, '-') } as TxRecord]
			})
			assert.fail('Should have thrown error for bad record')
		} catch (e) {
			assert.ok(e instanceof Error)
			assert.ok(e.message.includes('Invalid arguments'))
		}
	})


	it('should process correct input', async () => {
		const counts = await addonHandler({
			addonPrefix,
			records: [mockRecord as TxRecord]
		}, async (txid, parent, parents) => ({ start: -1n, end: -1n, dataStart: -1n, dataSize: -1n })
		)
		assert.equal(counts.inserted.length, 1)
		assert.equal(counts.flagged.length, 1)
		const firstRecord = await knex<TxRecord>(`${addonPrefix}_txs`).where('txid', mockRecord.txid).first()
		assert(firstRecord)
		assert.equal(firstRecord.byte_start, '-1')
		assert.equal(firstRecord.byte_end, '-1')
		assert.equal(firstRecord.flagged, true)

		/** test for existing record, let's use same record above, but with valid byte-range */
		const counts2 = await addonHandler({
			addonPrefix,
			records: [{ ...mockRecord, data_reason: 'negligible-data' } as TxRecord]
		}, async (txid, parent, parents) => ({ start: 1n, end: 2n, dataStart: -1n, dataSize: -1n })
		)
		assert.equal(counts2.inserted.length, 1)
		assert.equal(counts2.flagged.length, 1)
		const updatedRecord = await knex<TxRecord>(`${addonPrefix}_txs`).where('txid', mockRecord.txid).first()

		assert(updatedRecord)
		assert.equal(updatedRecord.byte_start, '1')
		assert.equal(updatedRecord.byte_end, '2')
		assert.equal(updatedRecord.data_reason, 'negligible-data')

	})

	it('should never overwrite "flagged:true", and return invalid records for invalid flagged transition', async () => {
		/** intial record */
		await addonHandler({
			addonPrefix,
			records: [mockRecord as TxRecord]
		})
		const mockRecordWithoutFlagged = { ...mockRecord } as TxRecord
		//@ts-ignore
		delete mockRecordWithoutFlagged.flagged

		/** invalid true => undefined */
		const result1 = await addonHandler({
			addonPrefix,
			records: [mockRecordWithoutFlagged]
		})
		assert.equal(result1.invalid.length, 1)
		assert.ok(result1.invalid[0].msg.includes('Cannot update a flagged record to unflagged'))

		/** invalid true => false */
		const result2 = await addonHandler({
			addonPrefix,
			records: [{ ...mockRecord, flagged: false } as TxRecord]
		})
		assert.equal(result2.invalid.length, 1)
		assert.ok(result2.invalid[0].msg.includes('Cannot update a flagged record to unflagged'))
	})

})

