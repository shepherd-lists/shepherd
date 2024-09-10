import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import pool from '../libs/utils/pgClient'
import knexCreate from '../libs/utils/knexCreate';
import { processFlagged, createInfractionsTable } from '../services/http-api/src/flagged';
import { dropOwnerTables, ownerToInfractionsTablename, ownerToOwnerTablename } from '../libs/block-owner/owner-table-utils';

import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { moveInboxToTxs } from '../services/http-api/src/move-records'

console.info(`using ${process.env.HTTP_API} for HTTP_API ip address`)

const knex = knexCreate()

describe('http api', () => {
	const mockId1 = 'mock-id1'.padEnd(43, '-')
	const mockId2 = 'mock-id2'.padEnd(43, '-')
	const mockOwner = 'mock-owner'.padEnd(43, '-')
	const mockIdClassified = 'classified1'.padEnd(43, '-')
	const mockIdClassified2 = 'classified2'.padEnd(43, '-')

	const mockTxRecord = {
		txid: mockId1,
		owner: mockOwner,

		/* requred but unused below */
		content_type: 'text/plain',
		content_size: '123',
		data_reason: 'unsupported',
		flagged: null,
		height: 123,
		last_update_date: new Date(),
		parent: null,
		valid_data: true,
	}

	const mockClassifiedRecord: TxRecord = {
		txid: mockIdClassified,
		content_type: 'text/plain',
		flagged: true,
		valid_data: true,
		height: 123,
		content_size: '123',
		data_reason: 'mimetype',

		last_update_date: new Date(),
		parent: null,
		owner: mockOwner,
		flag_type: 'classified',
		top_score_name: 'nsfw',
		top_score_value: 0.999,
		byteStart: '123',
		byteEnd: '456', // ********** test these DON'T get overwritten with either `null` or `-1`
	}

	beforeEach(async () => {
		await pool.query("DELETE FROM owners_list WHERE owner = $1", [mockOwner])
	})

	afterEach(async () => {
		await pool.query(`DELETE FROM txs WHERE txid in ($1, $2, $3, $4)`, [mockId1, mockId2, mockIdClassified, mockIdClassified2])
		await pool.query('DELETE FROM inbox WHERE txid in ($1, $2)', [mockIdClassified, mockIdClassified2])
		// await pool.query(`DROP TABLE IF EXISTS "${ownerToInfractionsTablename(mockOwner)}"`)
		// await pool.query(`DROP TABLE $1`, [ownerToOwnerTablename(mockOwner)])
		await dropOwnerTables(mockOwner) //this does both tables
	})
	after(async () => {
		await pool.end()
		await knex.destroy()
	})



	it('should pass for processFlagged', async () => {
		await processFlagged(
			mockId1,
			//@ts-expect-error flagged should be boolean
			mockTxRecord,
			{
				flagged: true,
			}
		)
		const record = await pool.query(`SELECT * FROM txs WHERE txid = $1`, [mockId1])
		assert.equal(record.rows[0].flagged, true)
		const infractionsExists = await knex.schema.hasTable(ownerToInfractionsTablename(mockOwner))
		assert.ok(infractionsExists)
		const flaggedTxExists = await pool.query(`SELECT * FROM "${ownerToInfractionsTablename(mockOwner)}" WHERE txid = $1`, [mockId1])
		assert.equal(flaggedTxExists.rowCount, 1)

		/** try hitting the infraction limit > 1 for this wallet */
		await processFlagged(
			mockId2,
			//@ts-expect-error flagged should be boolean
			{ ...mockTxRecord, txid: mockId2 },
			{
				flagged: true,
			}
		)
		const infractionCount = await knex('owners_list').where('owner', mockOwner).first()
		assert.equal(infractionCount.infractions, 2)
		const infractionIds = await pool.query(`SELECT txid FROM "${ownerToInfractionsTablename(mockOwner)}"`)
		assert.equal(infractionIds.rowCount, 2)

		/** N.B. our mock owner won't have any real txids, so GQL returns empty and no lambdas are run */

	})

	it('moveInboxToTxs insert-merge should overwrite column values when latest are null', async () => {

		await knex<TxRecord>('txs').insert(mockClassifiedRecord)

		/* update the data */
		const updates: TxRecord = {
			...mockClassifiedRecord,
			flagged: false, //should overwrite
			top_score_name: undefined,
			byteStart: undefined,
			byteEnd: '-1',
		}
		delete updates.top_score_value

		await knex<TxRecord>('inbox').insert(updates)

		const resInboxMove = await moveInboxToTxs([mockClassifiedRecord.txid])

		const record = await knex<TxRecord>('txs').where({ txid: mockClassifiedRecord.txid }).first() as TxRecord
		// console.debug({ record })

		//sanity checks
		assert.equal(resInboxMove, 1)
		assert.equal(record.content_type, mockClassifiedRecord.content_type)
		assert.equal(record.valid_data, mockClassifiedRecord.valid_data)
		assert.equal(record.height, mockClassifiedRecord.height)
		//probly more than enough

		//actual tests
		assert.equal(record.byteStart, '123')
		assert.equal(record.byteEnd, '456')
		assert.equal(record.top_score_name, null)
		assert.equal(record.top_score_value, null)
		assert.equal(record.flagged, false)
	})

	it('should log appropriate detail when an owner breaches infractions', async () => {
		/* load up inbox, then call `processFlagged` `infraction_limit` times  */
		//make variable names the same
		const owner = mockOwner
		const infractionsTablename = ownerToInfractionsTablename(owner)
		const trx = knex
		const infractions = 2 //for example
		const txid = mockIdClassified2
		const slackLog = console.log

		//insert test records for the owner
		await knex('txs').insert([mockClassifiedRecord, { ...mockClassifiedRecord, txid: mockIdClassified2 }])
		await createInfractionsTable(owner)
		await knex(infractionsTablename).insert([{ txid: mockIdClassified }, { txid: mockIdClassified2 }])

		/// this is our code snippet (easier than importing)
		//
		const infractionRecs = await trx<TxRecord>('txs').whereIn('txid', function () {
			this.select('txid').from(infractionsTablename)
		})
		slackLog(processFlagged.name, `:warning: started blocking owner: ${owner} with ${infractions} infractions. ${txid}`, JSON.stringify(infractionRecs, null, 2))
		//
		/// end of snippet

	})

})

