import 'dotenv/config'
import { updateAddresses, updateS3Lists } from '../s3-lists/update-lists'
import pg from '../utils/pgClient'
import { after, describe, it } from 'node:test'
import assert from 'assert/strict'
import QueryStream from 'pg-query-stream'
import { Readable } from 'stream'
import { ByteRange } from '../s3-lists/merge-ranges'
import { s3CheckFolderExists, s3DeleteFolder, s3ListFolderObjects } from '../utils/s3-services'

console.debug('LISTS_BUCKET', process.env.LISTS_BUCKET)
const bucket = process.env.LISTS_BUCKET!

describe('update lists', () => {

	it('should be able to update addresses (not currently testing anything apart from no errors)', async () => {
		await assert.doesNotReject(async () => {
			await updateAddresses()
		})
	})

	it('should run a test update on s3 folders', async () => {
		/** create fake update data */
		const folder = 'update-test/'
		const items: { txid: string; range: ByteRange; op?: 'remove' }[] = [
			{ txid: 'fake-txid-0001', range: [100, 200] },
			{ txid: 'fake-txid-0002', range: [300, 400] },
			{ txid: 'fake-txid-0003', range: [500, 600], op: 'remove' },
		]

		/** tests */
		const res = await updateS3Lists(folder, items)

		assert.ok(await s3CheckFolderExists(bucket, folder))
		const listnames = await s3ListFolderObjects(bucket, folder)
		assert.equal(listnames.length, 2) //txids & ranges lists


		/** cleaup */
		await assert.doesNotReject(async () => await s3DeleteFolder(bucket, folder))
	})

	after(async () => {
		await pg.end()
	})

})