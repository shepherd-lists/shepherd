import { after, describe, it, skip } from 'node:test'
import assert from 'node:assert/strict'
import { destroyGatewayAgent, gatewayStream } from '../lambdas/fnIngress/gatewayStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { processRecord } from '../lambdas/fnIngress/downloadWithChecks'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { s3DeleteObject, s3HeadObject } from '../libs/utils/s3-services'


describe('downloadWithChecks', () => {

	const smallDataId = '-m9UVTGfQZYlHAukiPzCnO9Q7EdHebHmLuUbb2fp6qA'

	after(async () => {
		destroyGatewayAgent()
		clearTimerHttpApiNodes()
		// await s3DeleteObject(process.env.AWS_INPUT_BUCKET!, 'test-404')
	})

	it('should upload an image file to S3 and check txrecord metadata', async () => {
		const res = await processRecord({
			txid: smallDataId, //small data-item
			content_type: 'image/webp',
		} as TxRecord)

		assert(res.queued === true, 'should have queued the image file')

		try {
			const data = await s3HeadObject(process.env.AWS_INPUT_BUCKET!, res.record.txid)

			const metadata = JSON.parse(data.Metadata?.txrecord || '{}')
			assert.ok(metadata, 'should have metadata')

			metadata.last_update_date = new Date(metadata.last_update_date) //string !== Date()

			assert.deepEqual(metadata, res.record, 'should have the same metadata')
		} catch (e) {
			assert.fail(`should have found the object, got ${String(e)}`)
		}
	})

	it('should cancel a download when invalid file-type detected', async () => {
		const res = await processRecord({
			txid: '060CDwAtjAd4MPrazzeEDMu4jmczC6AmoYd-0U8D7ks',
			content_type: 'test/fake', //application/pdf
		} as TxRecord)

		assert(res.queued === false, 'should have cancelled the download')
		assert(res.record.flagged === false, 'should have set flagged to false')
		assert(res.record.valid_data === false, 'should have set valid_data to false') //may remove at some point
		assert(res.record.data_reason === 'mimetype', 'should have set data_reason to mimetype')
		assert(res.record.content_type === 'application/pdf', `should have set content_type to 'application/pdf', got "${res.record.content_type}"`)
	})

	it('should handle a 404', async () => {
		const noDataId = 'kbn9dYQayN0D7BNsblAnrnlQnQtbXOA6foVUkk5ZHgw' //13 byte

		const res = await processRecord({
			txid: noDataId,
			content_type: 'unknown',
		} as TxRecord)

		assert(res.queued === false, 'should have cancelled the html file download')
		assert(res.record.flagged === false, 'should have set flagged to false')
		assert(res.record.valid_data === false, 'should have set valid_data to false') //may remove at some point
		assert(res.record.data_reason === '404', 'should have set data_reason to mimetype')
	})



})