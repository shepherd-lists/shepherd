import { s3UploadReadable, s3CheckFolderExists } from "../utils/s3-services"
import { slackLog } from "../utils/slackLog"
import { ByteRange } from "./merge-ranges"
import { lambdaInvoker } from "../utils/lambda-invoker"
import { keyExists, s3GetTag, updateAddresses } from "./update-addresses"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const LISTS_BUCKET = process.env.LISTS_BUCKET as string
const FN_INIT_LISTS = process.env.FN_INIT_LISTS as string


/** this is called once on service start */
let _inProgess_initLists = false
export const initLists = async () => {
	if (_inProgess_initLists) {
		console.info(initLists.name, 'already in progress')
		return;
	}
	_inProgess_initLists = true
	let count = 0
	try {

		/** check if addresses.txt need to be created */
		if (!await keyExists('addresses.txt') || !await s3GetTag('addresses.txt', 'SHA-1')) {
			console.info(`list 'addresses.txt' or it's SHA-1 hash does not exist. creating...`)
			console.info(
				'addresses.txt count',
				await updateAddresses()
			)
		}

		/** 
		 * THIS HAS TO BE A ONE-OFF OPERATION. 
		 * it recreates all lists in full as a starting point before any updates applied. 
		*/
		const exists = await Promise.all([
			s3CheckFolderExists(LISTS_BUCKET, 'list/'),
			s3CheckFolderExists(LISTS_BUCKET, 'flagged/'),
			s3CheckFolderExists(LISTS_BUCKET, 'owners/'),
			//addons?
		])
		//extra careful here. must be a blank slate
		if (exists.every(exist => exist === false)) {
			console.info('s3 folders do not exist. initialising all lists...')
			//call the fnInitLists invoker 
			count = await lambdaInvoker(FN_INIT_LISTS, {}, 3)
		}

	} finally {
		_inProgess_initLists = false
	}
	console.info(initLists.name, 'done')
}



export interface UpdateItem {
	txid: string
	range: ByteRange
	op?: 'remove'
}
export const newUpdateKeyPostfix = () => new Date().toISOString().replace(/[:.]/g, '-') + '.txt'

export const updateS3Lists = async (
	listname: string,
	records: Array<UpdateItem> | AsyncIterable<UpdateItem>
) => {
	const path = listname.endsWith('/') ? listname : listname + '/'

	const postfix = newUpdateKeyPostfix()
	const keyTxids = `${path}txids_${postfix}`
	const keyRanges = `${path}ranges_${postfix}`

	const txids = s3UploadReadable(LISTS_BUCKET, keyTxids)
	const ranges = s3UploadReadable(LISTS_BUCKET, keyRanges)

	let count = { txids: 0, ranges: 0 }
	for await (const { txid, range, op } of records) {
		const remove = op ? ',remove' : ''
		txids.write(`${txid}${remove}\n`)
		++count.txids
		if (Number(range[0]) !== -1) {
			++count.ranges
			ranges.write(`${range[0]},${range[1]}${remove}\n`)
		} else {
			slackLog(`${path}*_${postfix} :warning: skipped range ${txid}`, JSON.stringify({ range }))
		}
	}

	txids.end()
	ranges.end()
	await Promise.all([txids.promise, ranges.promise])

	await slackLog(`${path}*_${postfix} created with ${count.txids} txids & ${count.ranges} ranges`, JSON.stringify({ keyTxids, keyRanges }))
	return count //for testing
}
