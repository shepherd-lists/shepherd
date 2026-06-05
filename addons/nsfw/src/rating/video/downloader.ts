import fs from 'fs'
import { pipeline } from 'stream/promises'
import { VID_TMPDIR, VID_TMPDIR_MAXSIZE } from '../../constants'
import { logger } from '../../utils/logger'
import { VidDownloadRecord, VidDownloads } from './VidDownloads'
import { slackLogger } from '../../utils/slackLogger'
import si from 'systeminformation'
import { s3, AWS_INPUT_BUCKET } from '../../utils/aws-services'


const downloads = VidDownloads.getInstance()

export const addToDownloads = async (vid: { txid: string; content_size: string, content_type: string, receiptHandle: string }) => {

	// convert to a new VidDownloadRecord
	const dl: VidDownloadRecord = { ...vid, complete: 'FALSE' }
	downloads.push(dl)

	//ensure this is called async
	videoDownload(dl)
		.then((res) => {
			logger(dl.txid, 'finished downloading', res)
		}).catch(async e => {
			logger(dl.txid, `UNHANDLED error in ${videoDownload.name}`, e.name, e.message, e.code, e)
			slackLogger(dl.txid, `UNHANDLED error in ${videoDownload.name}`, e.name, e.message, e.code)
			logger(dl.txid, await si.fsSize())
			// throw e;
		})

	const mb = 1024 * 1024
	logger(vid.txid, vid.content_size, `downloading video ${(downloads.size() / mb).toFixed(1)}MB/${VID_TMPDIR_MAXSIZE / mb}MB`, `${downloads.length()} vids in process.`)
}

const DOWNLOAD_MAX_ATTEMPTS = 3

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * aws-sdk v2 `maxRetries` only covers the initial request, not an aborted response-body
 * stream. Under load our `pipeline` backpressure can stall the read socket long enough for it
 * to be torn down (surfaces as ECONNRESET/aborted) even though the object is sitting in local
 * MinIO. A fresh getObject stream almost always succeeds, so retry the whole download here.
 */
export const videoDownload = async (vid: VidDownloadRecord): Promise<boolean> => {
	const folderpath = VID_TMPDIR + vid.txid + '/'
	fs.mkdirSync(folderpath, { recursive: true })

	for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
		try {
			const filewriter = fs.createWriteStream(folderpath + vid.txid)
			const stream = s3.getObject({ Bucket: AWS_INPUT_BUCKET, Key: vid.txid }).createReadStream()

			// pipeline handles all stream cleanup and error propagation automatically
			await pipeline(stream, filewriter)

			vid.complete = 'TRUE'
			return true

		} catch (err: unknown) {
			const e = err as Error & { code?: string; response?: { code?: string } }
			const code = e.code || undefined
			logger(vid.txid, `ERROR in videoDownload (attempt ${attempt}/${DOWNLOAD_MAX_ATTEMPTS})`, e.name, ':', code, ':', e.message)

			if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
				await sleep(attempt * 1000) //linear backoff: 1s, 2s
				continue
			}

			// attempts exhausted: leave it to the harness to release back to SQS for a fresh try later
			vid.complete = 'ERROR'
			slackLogger(vid.txid, 'ERROR in videoDownload, attempts exhausted', e.name, ':', code, ':', e.message)
			logger(vid.txid, await si.mem())

			throw e
		}
	}

	return false //unreachable: loop either returns true or throws
}
