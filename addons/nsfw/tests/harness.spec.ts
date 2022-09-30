process.env['NODE_ENV'] = 'test'
import 'mocha'
import { expect } from 'chai'
import { getFile } from '../src/index'
import { S3 } from 'aws-sdk'
import { readFileSync } from 'fs'


const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.SQS_LOCAL==='yes' && { endpoint: process.env.S3_LOCAL_ENDPOINT!, region: 'dummy-value' }),
	maxRetries: 10,
})

describe(`harness tests. s3, sqs, etc`, ()=>{
	it(`tests we can retrieve an s3 object`, async()=>{
		/* test set up */
		const file = readFileSync(`${__dirname}/`+'./assets/test.png')
		const Bucket = 'shepherd-input-mod-local'
		const Key = 'test.png'
		s3.upload({
				Bucket, //this can only be run locally then
				Key,
				Body: file,
			},
			{},
			(e, data) => {
				if(e) throw e;
				console.log(`data uploaded`, {data})
			}
		)

		const res = await getFile(Bucket, Key)
		console.log({ res })

		expect(true).true
	}).timeout(10000)
})
