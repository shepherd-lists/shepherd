import 'dotenv/config'
import assert from 'node:assert/strict'
import { afterEach } from 'node:test'
import { UpdateItem, updateS3Lists } from '../libs/s3-lists/update-lists'
import { updateAddresses } from '../libs/s3-lists/update-addresses'
import pg, { batchInsert } from '../libs/utils/pgClient'
import { after, describe, it } from 'node:test'
import { ByteRange } from '../libs/s3-lists/merge-ranges'
import { s3CheckFolderExists, s3DeleteFolder, s3GetObject, s3ListFolderObjects } from '../libs/utils/s3-services'
import { Readable } from 'node:stream'
import { createOwnerTable, dropOwnerTables, ownerToOwnerTablename } from '../libs/block-owner/owner-table-utils'
import { initListBasic } from '../libs/s3-lists/initial-lists'

console.debug('LISTS_BUCKET', process.env.LISTS_BUCKET)
const bucket = process.env.LISTS_BUCKET!

describe('s3 lists', () => {

	/** fake data and cleanup */
	const testFolder = 'update-test/'
	const testOwner = 'fake_owner_'.padEnd(43, '0')

	afterEach(async () => {
		await s3DeleteFolder(bucket, testFolder)
		await dropOwnerTables(testOwner) //if exists
	})

	after(async () => {
		await pg.end()
	})

	it('should be able to update addresses (not currently testing anything apart from no errors)', async () => {
		await assert.doesNotReject(async () => {
			await updateAddresses()
		})
	})

	it('updateS3Lists should update an s3 folder', async () => {
		/** create fake update data */
		const items: { txid: string; range: ByteRange; op?: 'remove' }[] = [
			{ txid: 'fake-txid-0001', range: [100, 200] },
			{ txid: 'fake-txid-0002', range: [300, 400] },
			{ txid: 'fake-txid-0003', range: [500, 600], op: 'remove' },
		]

		/** tests */
		const res = await updateS3Lists(testFolder, items)

		assert.ok(await s3CheckFolderExists(bucket, testFolder))
		const listnames = await s3ListFolderObjects(bucket, testFolder)
		assert.equal(listnames.length, 3) //txids & ranges lists + .last_update file
	})

	it('updateS3Lists should update an s3 folder using stream input', async () => {

		const totalItems = 1000
		let i = 1
		let stream = new Readable({
			objectMode: true,
			read() {
				if (i > totalItems) {
					stream.push(null)
					return
				}
				stream.push({
					txid: `fake-txid-${i}`,
					range: i % 400 === 0 ? [-1, -1] : [i * 100, (i + 1) * 100],
					...((Math.random() < 0.1) && { op: 'remove' }),
				})
				++i;
			}
		})

		const count = await updateS3Lists(testFolder, stream)

		assert.equal(count.txids, totalItems, 'txid count doesnt match')
		assert.equal(count.ranges, totalItems - Math.floor(totalItems / 400), 'ranges count doesnt match')

		/** check the actual s3 objects */
		assert.ok(await s3CheckFolderExists(bucket, testFolder))
		const listnames = await s3ListFolderObjects(bucket, testFolder)
		assert.equal(listnames.length, 3) //txids & ranges lists + .last_update file

		const txidsName = listnames.find(n => n.Key.includes('txids'))!.Key
		const rangesName = listnames.find(n => n.Key.includes('ranges'))!.Key

		assert.equal((await s3GetObject(bucket, txidsName)).split('\n').length - 1, totalItems)
		assert.equal((await s3GetObject(bucket, rangesName)).split('\n').length - 1, totalItems - Math.floor(totalItems / 400))

	})

	it('should initialise a list using the database', async () => {
		/** create some fake table data */
		const totalItems = 10
		const tablename = await createOwnerTable('fake_owner_'.padEnd(43, '0'))
		const records = Array.from({ length: totalItems }, (_, i) => ({
			txid: crypto.randomUUID().padEnd(43, '-').substring(0, 43), //random enough 43 chars
			byte_start: Math.floor(Math.random() * 1_000_000),
			byte_end: Math.floor(Math.random() * 1_000_000),
		}))
		await batchInsert(records, tablename)

		/** the test */
		const counts = await initListBasic({ Bucket: bucket, folder: testFolder, query: `SELECT txid, byte_start, byte_end FROM ${tablename}` })
		assert.equal(counts.ranges, totalItems)
		assert.equal(counts.txids, totalItems)

		/** examine lists */
		const listnames = await s3ListFolderObjects(bucket, testFolder)
		assert.equal(listnames.length, 3, `listnames.length should be 3: ${JSON.stringify(listnames)}`) //txids & ranges lists + .last_update file. these get cleared every test run

		const txidsName = listnames.find(n => n.Key.includes('txids'))!.Key //probably could do with a util for grabbing pairs of list names later
		const rangesName = listnames.find(n => n.Key.includes('ranges'))!.Key
		assert.equal((await s3GetObject(bucket, txidsName)).split('\n').length - 1, totalItems)
		assert.equal((await s3GetObject(bucket, rangesName)).split('\n').length - 1, totalItems)

	})

	it('should initialise a list with no items', async () => {
		const tablename = await createOwnerTable('fake_owner_'.padEnd(43, '0'))
		//dont create any records

		/** the test */
		const counts = await initListBasic({ Bucket: bucket, folder: testFolder, query: `SELECT txid, byte_start, byte_end FROM ${tablename}` })
		assert.equal(counts.ranges, 0)
		assert.equal(counts.txids, 0)

		/** examine lists */
		const listnames = await s3ListFolderObjects(bucket, testFolder)
		assert.equal(listnames.length, 3, `listnames.length should be 3: ${JSON.stringify(listnames)}`) //txids & ranges lists + .last_update file

		const txidsName = listnames.find(n => n.Key.includes('txids'))!.Key //probably could do with a util for grabbing pairs of list names later
		const rangesName = listnames.find(n => n.Key.includes('ranges'))!.Key
		assert.equal((await s3GetObject(bucket, txidsName)).length, 0)
		assert.equal((await s3GetObject(bucket, rangesName)).length, 0)
	})


})