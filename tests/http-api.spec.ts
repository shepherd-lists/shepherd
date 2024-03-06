import 'dotenv/config'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import pool from '../libs/utils/pgClient'
import knexCreate from '../libs/utils/knexCreate';
import { processFlagged } from '../services/http-api/src/flagged';
import { ownerToInfractionsTablename, ownerToOwnerTablename } from '../libs/block-owner/owner-table-utils';

console.info(`using ${process.env.HTTP_API} for HTTP_API ip address`)

const knex = knexCreate()

describe('http api', () => {
	const mockId1 = 'mock-id1'.padEnd(43, '-')
	const mockId2 = 'mock-id2'.padEnd(43, '-')
	const mockOwner = 'mock-owner'.padEnd(43, '-')

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

	beforeEach(async () => {
		await pool.query("DELETE FROM owners_list WHERE owner = $1", [mockOwner])
	})

	afterEach(async () => {
		await pool.query(`DELETE FROM txs WHERE txid in ($1, $2)`, [mockId1, mockId2])
		await pool.query(`DROP TABLE "${ownerToInfractionsTablename(mockOwner)}"`)
		// await pool.query(`DROP TABLE $1`, [ownerToOwnerTablename(mockOwner)])
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

})

