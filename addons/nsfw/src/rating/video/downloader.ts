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
	const dl: VidDownloadRecord & { retried: boolean } = { ...vid, complete: 'FALSE', retried: false }
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

export const videoDownload = async (vid: VidDownloadRecord): Promise<boolean> => {
	const folderpath = VID_TMPDIR + vid.txid + '/'
	fs.mkdirSync(folderpath, { recursive: true })

	try {
		const filewriter = fs.createWriteStream(folderpath + vid.txid)
		const stream = s3.getObject({ Bucket: AWS_INPUT_BUCKET, Key: vid.txid }).createReadStream()

		// pipeline handles all stream cleanup and error propagation automatically
		await pipeline(stream, filewriter)

		vid.complete = 'TRUE'
		return true

	} catch (err: unknown) {
		const e = err as Error & { code?: string; response?: { code?: string } }
		vid.complete = 'ERROR'

		const code = e.response?.code || e.code || 'no-code'
		logger(vid.txid, 'ERROR in videoDownload', e.name, ':', code, ':', e.message)
		slackLogger(vid.txid, 'ERROR in videoDownload', e.name, ':', code, ':', e.message)
		logger(vid.txid, await si.mem())

		throw e
	}
}
