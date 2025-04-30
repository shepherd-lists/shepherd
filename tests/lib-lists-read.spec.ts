import 'dotenv/config'
import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { initRamList } from '../libs/s3-lists/read-lists'
import { s3DeleteFolder } from '../libs/utils/s3-services'
import { UpdateItem, updateS3Lists } from '../libs/s3-lists/update-lists'


describe('initRamList', () => {

	const listname = 'ram-read-test'
	const testRecords1: UpdateItem[] = [
		{ txid: 'txid01', range: [100, 200] },
		{ txid: 'txid02', range: [50, 100] },
		{ txid: 'txid03', range: [150, 250] },
	]
	const testRecords2: UpdateItem[] = [
		{ txid: 'txid04', range: [300, 400] },
		{ txid: 'txid03', range: [150, 250], op: 'remove' }, //there an issue here when chunks overlap
		{ txid: 'txid05', range: [350, 450] },
		{ txid: 'txid06', range: [400, 500] },
	]

	beforeEach(async () => {
		await updateS3Lists(listname, testRecords1)
		await updateS3Lists(listname, testRecords2)
	})
	afterEach(async () => {
		await s3DeleteFolder(process.env.LISTS_BUCKET!, listname)
	})

	it('should apply updates in order', async () => {
		const { txids, ranges } = await initRamList(listname)
		assert.deepEqual(txids.txids(), ['txid01', 'txid02', 'txid04', 'txid06'])
		assert.deepEqual(await ranges.getRanges(), [[50, 150], [300, 500]])
	})

})
