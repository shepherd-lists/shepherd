import { after, describe, it, skip } from 'node:test'
import assert from 'node:assert/strict'
import { destroyGatewayAgent, gatewayStream } from '../lambdas/fnIngress/gatewayStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { processRecord } from '../lambdas/fnIngress/downloadWithChecks'
import { TxRecord } from 'shepherd-plugin-interfaces/types'


describe('downloadWithChecks', () => {

	after(() => {
		destroyGatewayAgent()
		clearTimerHttpApiNodes()
	})

	it('should download an image file', async () => {
		const res = await processRecord({
			txid: '-m9UVTGfQZYlHAukiPzCnO9Q7EdHebHmLuUbb2fp6qA', //small data-item
			content_type: 'image/webp',
		} as TxRecord)

		assert(res.queued === true, 'should have queued the image file')
	})

	it('should cancel a html file download', async () => {
		const res = await processRecord({
			txid: '060CDwAtjAd4MPrazzeEDMu4jmczC6AmoYd-0U8D7ks',
			content_type: 'test/fake',
		} as TxRecord)

		assert(res.queued === false, 'should have cancelled the html file download')
		assert(res.record!.valid_data === false, 'should have set valid_data to false')
		assert(res.record!.data_reason === 'mimetype', 'should have set data_reason to mimetype')
		assert(res.record!.content_type === 'application/pdf', `should have set content_type to text/html, got "${res.record!.content_type}"`)
	})
})