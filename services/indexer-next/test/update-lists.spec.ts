import 'dotenv/config'
import { updateAddresses } from '../src/update-lists'
import pg from '../../../libs/utils/pgClient'
import { after, describe, it } from 'node:test'
import assert from 'assert/strict'
import QueryStream from 'pg-query-stream'
import { Readable } from 'stream'



describe('update addresses', () => {

	it('should be able to update addresses (not currently testing anything apart from no errors)', async () => {
		await assert.doesNotReject(async () => {
			await updateAddresses()
		})
	})

	it('should stream sql results', async () => {
		const stream = new QueryStream('SELECT txid FROM txs WHERE flagged = true', [])
		const client = await pg.connect()
		client.query(stream)
		for await (const row of stream) {
			console.log('row', row)
		}
		client.release()

	})


	after(async () => {
		await pg.end()
	})

})