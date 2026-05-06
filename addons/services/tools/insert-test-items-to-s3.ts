/* 
 * upload files into s3 with faked TxRecord metadata for testing 
 */
import 'dotenv/config'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { readFileSync } from 'node:fs'
import { Upload } from '@aws-sdk/lib-storage'
import { S3Client } from '@aws-sdk/client-s3'

const testNames = [
	'./your-file1.jpg',
	'./your-file2.jpg',
	'./your-file3.jpg',
]
const content_type = 'image/jpeg' //this needs to be correct!

const s3client = new S3Client({
	maxAttempts: 3,
	retryMode: 'adaptive', // handles varying AWS load conditions
	forcePathStyle: true,
})
const AWS_INPUT_BUCKET = process.env.AWS_INPUT_BUCKET!

for (const testName of testNames) {
	const data = readFileSync(new URL(testName, import.meta.url).pathname)
	const record: Partial<TxRecord> = {
		txid: testName,
		content_type,
		content_size: data.length.toString(),
		height: 0,
		parent: null,
		parents: undefined,
		owner: 'test'.padEnd(43, '-'),
		valid_data: true,
		last_update_date: new Date(),
	}

	//create and start S3 upload
	const upload = new Upload({
		client: s3client,
		params: {
			Bucket: AWS_INPUT_BUCKET,
			Key: testName.split('/').pop()!,
			Body: data, //fussy types, we want the nodejs iterator version
			ContentType: content_type,
			Metadata: { txrecord: JSON.stringify(record) } //only lowercase supported in key name!!
		},
		// partSize: default & minimum is 5MB
		queueSize: 1, // that's queueSize * partSize per concurrent upload, up to 100
	})

	//wait for upload completion
	await upload.done()
	console.debug(`${record.txid} S3 upload completed successfully`)


}

/** 
 * N.B. objectCreated messages will go into the input queue automatically
 * you may want to move them to another queue?
 */