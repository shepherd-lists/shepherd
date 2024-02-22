import 'dotenv/config'
import { s3DeleteObject, s3Exists, s3GetObject, s3GetObjectStream, s3PutObject, s3UploadStream } from '../src/services/s3-services'
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readlineWeb } from '../src/utils/webstream-readline'

console.debug(`process.env.LISTS_BUCKET = "${process.env.LISTS_BUCKET}"`)
const bucketName = process.env.LISTS_BUCKET as string

describe('s3 services', () => {
	beforeEach(async () => {
		await s3PutObject(bucketName, 'test.txt', 'this is a test file\nline 2\nline 3\n')
	})
	afterEach(async () => {
		await s3DeleteObject(bucketName, 'test.txt')
	})

	it('should be able to read a file head from s3', async () => {
		const exists = await s3Exists(bucketName, 'test.txt')
		assert.equal(exists, true)
	})

	it('should be able to get an object from s3', async () => {
		const file = await s3GetObject(bucketName, 'test.txt')
		assert.ok(file, 'this should be defined')
	})

	it('should be able to get a file from s3 as a stream', async () => {
		const stream = await s3GetObjectStream(bucketName, 'test.txt')
		// console.debug('stream', stream)
		assert.ok(stream, 'stream defined')

		let count = 0
		for await (const line of readlineWeb(stream)) {
			count++
		}
		assert.equal(count, 3, 'there are 3 non-empty lines in the test file')
	})

	it('should be able to put a file to s3', async () => {
		const stream = Readable.toWeb(Readable.from('this is another test file\n')) as ReadableStream //might be issues?
		assert.ok(stream)

		await s3UploadStream(bucketName, 'test2.txt', stream)
		//if no error, upload should be successful
		const exists = await s3Exists(bucketName, 'test2.txt')
		assert.equal(exists, true)
		await s3DeleteObject(bucketName, 'test2.txt')
	})
})
