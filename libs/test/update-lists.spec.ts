import 'dotenv/config'
import assert from 'node:assert/strict'
import { afterEach } from 'node:test'
import { updateAddresses, UpdateItem, updateS3Lists } from '../s3-lists/update-lists'
import pg from '../utils/pgClient'
import { after, describe, it } from 'node:test'
import { ByteRange } from '../s3-lists/merge-ranges'
import { s3CheckFolderExists, s3DeleteFolder, s3GetObject, s3ListFolderObjects } from '../utils/s3-services'
import { Readable } from 'node:stream'

console.debug('LISTS_BUCKET', process.env.LISTS_BUCKET)
const bucket = process.env.LISTS_BUCKET!

describe('update lists', () => {

	const testFolder = 'update-test/'
	afterEach(async () => {
		await s3DeleteFolder(bucket, testFolder)
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
		assert.equal(listnames.length, 2) //txids & ranges lists
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
		assert.equal(listnames.length, 2) //txids & ranges lists

		const txidsName = listnames.find(n => n.includes('txids')) as string
		const rangesName = listnames.find(n => n.includes('ranges')) as string

		assert.equal((await s3GetObject(bucket, txidsName)).split('\n').length - 1, totalItems)
		assert.equal((await s3GetObject(bucket, rangesName)).split('\n').length - 1, totalItems - Math.floor(totalItems / 400))

	})

	after(async () => {
		await pg.end()
	})

})