import 'dotenv/config'
import { after, describe, it, skip } from 'node:test'
import assert from 'node:assert/strict'
import { destroyGatewayAgent, gatewayStream } from '../lambdas/fnIngress/gatewayStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { processRecord, downloadWithChecks } from '../lambdas/fnIngress/downloadWithChecks'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { s3HeadObject } from '../libs/utils/s3-services'
import { chunkTxDataStream } from '../lambdas/fnIngress/chunkTxDataStream'
import { createMockHttpsGet } from './mocks/mock-httpsGet'


describe('downloadWithChecks', () => {

	const smallDataId = 'SUIycDyPfSqkkYunexGcGXjjhujc4rM5KHUz9NP-JBI'
	const smallDataIdSize = 19371

	after(async () => {
		destroyGatewayAgent()
		clearTimerHttpApiNodes()
	})

	it('should upload an image file to S3 and check txrecord metadata', async () => {
		const res = await processRecord(
			{
				txid: smallDataId, //small data-item
				parent: 'l-bDXsnBUlD8taaCC1tAyW1CeuGbeTOUCFU-H5Ahzxk',
				content_type: 'image/webp',
				content_size: smallDataIdSize.toString(),
			} as TxRecord,
			(new AbortController()).signal,
		)

		assert(res.queued === true, 'should have queued the image file')

		try {
			const data = await s3HeadObject(process.env.AWS_INPUT_BUCKET!, res.record.txid)

			const metadata = JSON.parse(data.Metadata?.txrecord || '{}')
			assert.ok(metadata, 'should have metadata')

			metadata.last_update_date = new Date(metadata.last_update_date) //string !== Date()

			assert.deepEqual(metadata, res.record, 'should have the same metadata')

			assert.equal(Number(data.ContentLength), smallDataIdSize, 'should have the correct size')

		} catch (e) {
			assert.fail(`should have found the object, got ${String(e)}`)
		}
	})

	it('should cancel a download when invalid file-type detected', async () => {
		const res = await processRecord(
			{
				txid: '060CDwAtjAd4MPrazzeEDMu4jmczC6AmoYd-0U8D7ks',
				content_type: 'test/fake', //application/pdf
			} as TxRecord,
			(new AbortController()).signal,
		)

		assert(res.queued === false, 'should have cancelled the download')
		assert(res.record.flagged === false, 'should have set flagged to false')
		assert(res.record.valid_data === false, 'should have set valid_data to false') //may remove at some point
		assert(res.record.data_reason === 'mimetype', 'should have set data_reason to mimetype')
		assert(res.record.content_type === 'application/pdf', `should have set content_type to 'application/pdf', got "${res.record.content_type}"`)
	})

	it('should handle a 404', async () => {
		const noDataId = 'kbn9dYQayN0D7BNsblAnrnlQnQtbXOA6foVUkk5ZHgw' //13 byte

		const res = await processRecord(
			{
				txid: noDataId,
				content_type: 'unknown',
			} as TxRecord,
			(new AbortController()).signal,
		)

		assert(res.queued === false, 'should have cancelled the html file download')
		assert(res.record.flagged === false, 'should have set flagged to false')
		assert(res.record.valid_data === false, 'should have set valid_data to false') //may remove at some point
		assert(res.record.data_reason === '404', 'should have set data_reason to mimetype')
	})

	it('should handle an error', async () => {
		//gatewayStream
		const resGw = await processRecord(
			{ txid: 'error', content_type: 'unknown', } as TxRecord,
			(new AbortController().signal),
			gatewayStream,
		)

		assert(resGw.queued === false, 'queued should be false')
		assert.deepEqual(resGw.record, { txid: 'error', content_type: 'unknown', }, 'record should be passed through')
		assert(resGw.errorId?.includes('failed: 400'), `errorId: "${resGw.errorId}" didnt match`)

		//chunkTxDataStream
		const resChunk = await processRecord(
			{ txid: 'error', content_type: 'unknown', } as TxRecord,
			(new AbortController().signal),
			chunkTxDataStream,
		)

		assert(resChunk.queued === false, 'queued should be false')
		assert.deepEqual(resChunk.record, { txid: 'error', content_type: 'unknown', }, 'record should be passed through')
		assert(resChunk.errorId?.includes('undiscoverable byte-range'), 'errorId didnt match')
	})

	it('should process nodata and partial errors as expected', async () => {
		const abortSignal = new AbortController().signal
		const mockId = 'mockId-'.padEnd(43, '0')
		const resNodata = await processRecord({ txid: mockId } as TxRecord, abortSignal, () => gatewayStream(mockId, abortSignal, createMockHttpsGet({
			shouldTimeout: true,
			timeoutDelay: 100,
		}) as any))
		console.debug('resNodata', resNodata)
		assert(resNodata.queued === false, 'resNodata.queued should be false')
		assert(!resNodata.errorId, 'resNodata.errorId should not have an errorId')
		assert(resNodata.record.data_reason === 'nodata', 'resNodata.record.data_reason should be nodata')
		assert(resNodata.record.valid_data === false, 'resNodata.record.valid_data should be false')
		assert(resNodata.record.flagged === false, 'resNodata.record.flagged should be false')

		const resPartial = await processRecord({ txid: mockId } as TxRecord, abortSignal, () => gatewayStream(mockId, abortSignal, createMockHttpsGet({
			dataChunks: [Buffer.alloc(1000)], // Only 1000 bytes < 4096 min_data_size
			shouldTimeout: true,
			timeoutDelay: 100,
			shouldEnd: false // Don't end naturally, let timeout handle it
		}) as any))
		console.debug('resPartial', resPartial)
		assert(resPartial.queued === false, 'resPartial.queued should be false')
		assert(!resPartial.errorId, 'resPartial.errorId should not have an errorId')
		assert(resPartial.record.data_reason === 'nodata', 'resPartial.record.data_reason should be nodata as partial < min_data_size (4096)')
		assert(resPartial.record.valid_data === false, 'resPartial.record.valid_data should be false')
		assert(resPartial.record.flagged === false, 'resPartial.record.flagged should be false')
	})

	it('should process multiple records with downloadWithChecks function', async () => {
		// Using the 3 common test records from other unit tests
		const testRecords: TxRecord[] = [
			{
				txid: 'SUIycDyPfSqkkYunexGcGXjjhujc4rM5KHUz9NP-JBI', // small successfull upload
				parent: 'l-bDXsnBUlD8taaCC1tAyW1CeuGbeTOUCFU-H5Ahzxk',
				content_type: 'image/webp',
				content_size: smallDataIdSize.toString(),
			} as TxRecord,
			{
				txid: '060CDwAtjAd4MPrazzeEDMu4jmczC6AmoYd-0U8D7ks', // invalid file-type
				content_type: 'test/fake', //application/pdf
			} as TxRecord,
			{
				txid: 'kbn9dYQayN0D7BNsblAnrnlQnQtbXOA6foVUkk5ZHgw', // 404
				content_type: 'unknown',
			} as TxRecord
		]

		const results = await downloadWithChecks(testRecords, 30_000) // 30 second timeout

		assert.equal(results.length, 3)

		// Successful upload
		const [successResult, mimetypeResult, notFoundResult] = results

		// console.debug('successResult', successResult)
		// console.debug('mimetypeResult', mimetypeResult)
		// console.debug('notFoundResult', notFoundResult)

		assert.equal(successResult.queued, true, 'successResult.queued should be true')
		assert.equal(successResult.record.flagged, undefined, 'successResult.record.flagged should be undefined')
		assert.equal(successResult.record.valid_data, true, 'successResult.record.valid_data should be true')

		// Invalid mimetype rejection  
		assert.equal(mimetypeResult.queued, false, 'mimetypeResult.queued should be false')
		assert.equal(mimetypeResult.record.flagged, false, 'mimetypeResult.record.flagged should be false')
		assert.equal(mimetypeResult.record.valid_data, false, 'mimetypeResult.record.valid_data should be false')
		assert.equal(mimetypeResult.record.data_reason, 'mimetype', 'mimetypeResult.record.data_reason should be mimetype')
		assert.equal(mimetypeResult.record.content_type, 'application/pdf', 'mimetypeResult.record.content_type should be application/pdf')

		// 404 error
		assert.equal(notFoundResult.queued, false, 'notFoundResult.queued should be false')
		assert.equal(notFoundResult.record.flagged, false, 'notFoundResult.record.flagged should be false')
		assert.equal(notFoundResult.record.valid_data, false, 'notFoundResult.record.valid_data should be false')
		assert.equal(notFoundResult.record.data_reason, '404', 'notFoundResult.record.data_reason should be 404')
	})

	it('should handle timeout by returning records with errorId instead of throwing', async () => {
		const mockId = 'timeout-test-'.padEnd(43, '0')

		// Create a mock sourceStream that hangs indefinitely
		const hangingSourceStream = async () => {
			return new Promise<never>(() => {
				// Never resolves - simulates a hanging promise
			})
		}

		const testRecords: TxRecord[] = [
			{
				txid: mockId,
				content_type: 'image/webp',
			} as TxRecord
		]

		// Use short timeout for test (1 second)
		const results = await downloadWithChecks(testRecords, 1000, hangingSourceStream)

		assert.equal(results.length, 1, 'should return one result')

		const timeoutResult = results[0]
		assert.equal(timeoutResult.queued, false, 'timeout result should not be queued')
		assert.equal(timeoutResult.errorId, 'timeout', 'should have timeout errorId')
		assert.equal(timeoutResult.record.txid, mockId, 'should return the original record')
	})


	it('should retrieve data for a non-arweave signed data-item', async () => {
		const res = await processRecord(
			{
				txid: 'Qhd79IG7cHoAJpx5CZrOT62rloS8EneeOVMcjB8tobc',
				parent: 'BcOq2iOUyXSKtu4AXMtDyznmV5MF2antxuHm4mmQLBc',
				content_size: '90642',
				content_type: 'image/jpeg',
			} as TxRecord,
			(new AbortController()).signal,
		)

		assert.equal(res.queued, true, 'should have queued the data-item')
		assert.equal(res.record.flagged, undefined, 'should have set flagged to undefined')
		assert.equal(res.record.valid_data, true, 'should have set valid_data to true')
		assert.equal(res.record.data_reason, undefined, 'should have set data_reason to undefined')
		assert.equal(res.record.content_type, 'image/jpeg', 'should have set content_type to image/jpeg')

	})

})