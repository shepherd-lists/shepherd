import 'dotenv/config'
import { updateAddresses } from '../src/services/update-addresses'
import pg from '../src/utils/pgClient'
import { after, describe, it } from 'node:test'
import assert from 'assert/strict'



describe('update addresses', () => {

	it('should be able to update addresses (not currently testing anything apart from no errors)', async () => {
		await assert.doesNotReject(async () => {
			await updateAddresses()
		})
	})

	after(async () => {
		await pg.end()
	})

})