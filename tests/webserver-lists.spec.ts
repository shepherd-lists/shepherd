import 'dotenv/config'
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getList } from '../services/webserver-next/src/lists'
import { Writable } from 'node:stream'
import { s3DeleteObject, s3PutObject } from '../libs/utils/s3-services'

console.debug(`process.env.LISTS_BUCKET = "${process.env.LISTS_BUCKET}"`)
const bucketName = process.env.LISTS_BUCKET as string

describe('webserver lists', () => {

	beforeEach(async () => {

	})
	afterEach(async () => {
		await s3DeleteObject(bucketName, 'testing.txt')
	})

	it('should return a short list of test items', async () => {
		//gotta assume s3PutObject is well tested
		await s3PutObject(bucketName, 'testing.txt', 'this is a test file\nline 2\nline 3\n')

		let res = ''
		const writer = new Writable({
			write(chunk, encoding, next) {
				console.debug('chunk', chunk.toString())
				res += chunk.toString()
				next()
			},
		})

		await getList(writer, '/testing.txt')

		assert(res.length > 0)
		assert.equal(res.split('\n').length, 4, 'there are 3 lines in the test file + 1 empty line')

	})

	it('should return a very long list of test items', async (test) => {
		//gotta assume s3PutObject is well tested
		const numLines = 100_000
		const longList = Array(numLines).fill('this is a test file\n').join('')
		await s3PutObject(bucketName, 'testing.txt', longList)

		let res = ''
		const writer = new Writable({
			write(chunk, encoding, next) {
				// console.debug('chunk', chunk.toString())
				res += chunk.toString()
				next()
			},
		})

		await getList(writer, '/testing.txt')

		assert(res.length > 0)
		assert.equal(res.split('\n').length, numLines + 1, `there are ${numLines} lines in the test file + 1 empty line`)
	})


})
