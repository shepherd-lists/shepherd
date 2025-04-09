import 'dotenv/config'
import { s3DeleteObject, s3HeadObject, s3GetObject, s3GetObjectWebStream, s3PutObject, s3UploadStream, s3CheckFolderExists, s3ListFolderObjects, s3DeleteFolder } from '../../libs/utils/s3-services'
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readlineWeb } from '../../libs/utils/webstream-utils'

console.debug(`process.env.LISTS_BUCKET = "${process.env.LISTS_BUCKET}"`)
const Bucket = process.env.LISTS_BUCKET as string

describe('s3 services', () => {
	const Key = 'test.txt'
	beforeEach(async () => {
		await s3PutObject({ Bucket, Key, text: 'this is a test file\nline 2\nline 3\n' })
	})
	afterEach(async () => {
		await s3DeleteObject(Bucket, Key)
	})

	it('should be able to read a file head from s3', async () => {
		const exists = await s3HeadObject(Bucket, Key)
		assert.equal(exists.$metadata.httpStatusCode, 200, 'file exists')
	})

	it('should be able to get an object from s3', async () => {
		const file = await s3GetObject(Bucket, Key)
		assert.ok(file, 'this should be defined')
	})

	it('should be able to stream a file from s3', async () => {
		const stream = await s3GetObjectWebStream(Bucket, Key)
		// console.debug('stream', stream)
		assert.ok(stream, 'stream defined')

		let count = 0
		for await (const line of readlineWeb(stream)) {
			count++
		}
		assert.equal(count, 3, 'there are 3 non-empty lines in the test file')
	})

	it('should be able to stream a file to s3', async () => {
		const stream = Readable.toWeb(Readable.from('this is another test file\n')) as ReadableStream //might be issues?
		assert.ok(stream)

		await assert.doesNotReject(async () => {
			await s3UploadStream(Bucket, 'test2.txt', stream)
		})
		//if no error, upload should be successful
		const exists = await s3HeadObject(Bucket, 'test2.txt')
		assert.equal(exists.$metadata.httpStatusCode, 200, 'file exists')
		await s3DeleteObject(Bucket, 'test2.txt')
	})

	it('should check s3 folders existence & list files', async () => {
		const folder = 'test-folder/'
		const numFiles = 2001
		const keys = [...Array(numFiles).keys()].map(i => `${folder}${i.toString().padStart(4, '0')}.txt`)

		let batch = keys.splice(0, Math.max(100, keys.length))
		while (batch.length > 0) {
			await Promise.all(batch.map(Key => s3PutObject({ Bucket, Key, text: 'test content' })))
			batch = keys.splice(0, Math.max(100, keys.length))
		}

		const folderExists = await s3CheckFolderExists(Bucket, folder)
		assert.ok(folderExists)

		const list = await s3ListFolderObjects(Bucket, folder)
		assert.equal(list.length, numFiles)

		/* clean up */
		await assert.doesNotReject(async () => await s3DeleteFolder(Bucket, folder))
	})
})
