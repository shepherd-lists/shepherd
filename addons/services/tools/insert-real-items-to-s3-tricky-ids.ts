/* 
 * upload an image file to S3 with real TxRecord metadata
 * this is based on an unsaved unit test 'tricky-ids'
 */
import 'dotenv/config'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { processRecord } from '../lambdas/fnIngress/downloadWithChecks';
import { s3HeadObject } from '../libs/utils/s3-services';
import { destroyGatewayAgent } from '../libs/chunkStreams/gatewayStream';
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes';


/** 
 * N.B. objectCreated messages will go into the input queue automatically
 * you may want to move them to another queue?
 */

const records: Array<{ txid: string; parent?: string | null; parents?: string[]; content_size: string; owner?: string;[key: string]: unknown }> =
	//paste errors from slack here

	[{ "txid": "fpVz7DNonW2ly-ogNie-KUZxZAPM54w05VjKNM55b0I", "content_type": "image/png", "content_size": "320109", "height": 1865496, "parent": "cKPgVAy9UfKflpOMYJ0GG2ZaYsbNXUH0snXjAbgpREA", "parents": ["J89fBCw_3XEdwQsSOBpv_TJo3Gc5zLotU1sBv0nCE2w"], "owner": "n_NFtpofwDTlL_YHGblOsSJo9BZNLBdiP5v7417h9mY" }]



try {
	console.info('inserting real items to S3...')
	for (const { errorId, ...record } of records) {
		console.log('==== processing ', record.txid, ' ======')
		const res = await processRecord(
			{
				...record,
				txid: record.txid,
			} as TxRecord,
			(new AbortController).signal,
		)

		if (res.queued !== true) {
			console.error(`${record.txid} should have queued the image file, got ${res.queued}`)
			break;
		}

		try {
			const data = await s3HeadObject(process.env.AWS_INPUT_BUCKET!, res.record.txid)

			//this is not really necessary
			const metadata = JSON.parse(data.Metadata?.txrecord || '{}')
			if (!metadata) {
				console.error(`${record.txid} should have metadata, got ${metadata}`)
				break;
			}


		} catch (e) {
			console.error(`${record.txid} should have found the object, got ${String(e)}`)
			break;
		}
	}
} finally {
	//cleanup
	destroyGatewayAgent()
	clearTimerHttpApiNodes()
}
