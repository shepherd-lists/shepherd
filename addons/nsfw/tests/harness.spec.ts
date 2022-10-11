process.env['NODE_ENV'] = 'test'
import 'mocha'
import { expect } from 'chai'
import { getFile } from '../src/harness'
import { S3 } from 'aws-sdk'
import { readFileSync } from 'fs'
import { fetch } from 'undici'
import readline from 'readline'


const s3 = new S3({
	apiVersion: '2006-03-01',
	...(process.env.SQS_LOCAL==='yes' && { 
		endpoint: process.env.S3_LOCAL_ENDPOINT!, 
		region: 'dummy-value',
		s3ForcePathStyle: true, // *** needed with minio ***
	}),
	maxRetries: 1,
})

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe(`harness tests. s3, sqs, etc`, ()=>{
	it(`tests we can retrieve an s3 object`, async()=>{
		/* test set up */
		const file = readFileSync(`${__dirname}/`+'./fixtures/test.png')
		const Bucket = 'shepherd-input-mod-local'
		const Key = 'test.png'
		
		while(true){
			const { status } = await fetch(`http://s3-local:9000/minio/health/live`)
			if(status===200){
				console.log(`/minio/health/live ${status}`)
				break;
			}else{
				console.log(`/minio/health/live ${status}. waiting 5s..`)
				await sleep(5000)
			}
		}

		// const rl = readline.createInterface({input: process.stdin, output: process.stdout})
		// console.log(`press enter to continue`)
		// await rl[Symbol.asyncIterator]().next()
		

		const upload = await s3.upload({
			Bucket, //this can only be run locally then
			Key,
			Body: file,
		}).promise()
		// console.log(`upload success!`)

		const res = await getFile(Bucket, Key)
		// console.log({ res })

		expect(res.ContentLength).eq(37978)
	}).timeout(0)
})
