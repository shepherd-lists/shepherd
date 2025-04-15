import { s3HeadObject, s3PutObject, s3ObjectTagging, s3UploadReadable, s3CheckFolderExists } from "../utils/s3-services"
import { slackLog } from "../utils/slackLog"
import pool from '../utils/pgClient'
import { performance } from 'perf_hooks'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { ByteRange } from "./merge-ranges"
import { lambdaInvoker } from "../utils/lambda-invoker"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const LISTS_BUCKET = process.env.LISTS_BUCKET as string
const FN_INIT_LISTS = process.env.FN_INIT_LISTS as string


const keyExists = async (key: string) => {
	try {
		await s3HeadObject(LISTS_BUCKET, key)
		return true
	} catch (err) {
		const e = err as Error
		if (['NoSuchKey', 'NotFound'].includes((e.name))) {
			return false
		} else {
			slackLog(keyExists.name, `${e.name}:${e.message}`, JSON.stringify(e))
			throw new Error(`unexpected error`, { cause: e })
		}
	}
}
const s3GetTag = async (objectKey: string, tagKey: string) => {
	try {
		const tagging = await s3ObjectTagging(LISTS_BUCKET, objectKey)
		return tagging.TagSet?.find(tag => tag.Key === tagKey)!.Value as string
	} catch (e) {
		if (['NoSuchKey', 'NotFound'].includes(((e as Error).name)))
			return 'undefined'
		await slackLog(s3GetTag.name, objectKey, tagKey, String(e))
		throw new Error(`unexpected error`, { cause: e })
	}
}

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
		if (!(await keyExists('addresses.txt') || !await s3GetTag('addresses.txt', 'SHA-1'))) {
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

const ownersFromDb = async () => {
	/** addresses should be pretty small, otherwise we might use streams. order for hashing */
	let { rows } = await pool.query(
		`SELECT owners_list.owner FROM owners_list
			LEFT JOIN owners_whitelist ON owners_list.owner = owners_whitelist.owner
			WHERE owners_whitelist IS NULL
			AND (add_method = 'manual' OR add_method = 'blocked')
			ORDER BY owners_list.owner ASC`
	)
	const owners = rows.map((row: { owner: string }) => row.owner)
	return owners
}
const textHash = async (text: string) => {
	const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
	return Array.from(new Uint8Array(hashBuffer)).map((b: any) => b.toString(16).padStart(2, '0')).join('')
}

/** not really certain if /addresses.txt is going to be a feature, but we use it interally now. */
export const updateAddresses = async () => {
	try {

		const owners = await ownersFromDb()

		/** check if an update is actually required */
		const actualHash = await textHash(owners.join('\n') + '\n')
		const s3Hash = await s3GetTag('addresses.txt', 'SHA-1')
		if (actualHash === s3Hash) {
			console.info(updateAddresses.name, `not updating, hash for addresses.txt matches:\n${actualHash}\n${s3Hash}`)
			return false
		}

		console.info(updateAddresses.name, `updating addresses.txt... hash:${actualHash}, length:${owners.length}`, JSON.stringify(owners))

		await s3PutObject({ Bucket: process.env.LISTS_BUCKET!, Key: 'addresses.txt', text: owners.join('\n') + '\n', Sha1: actualHash })


		return owners.length

	} catch (err: unknown) {
		const e = err as Error
		slackLog(updateAddresses.name, `${e.name}:${e.message}`, JSON.stringify(e))
		throw e;
	}
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
			slackLog(listname, `:warning: skipped range ${txid}`, JSON.stringify({ range }))
		}
	}

	txids.end()
	ranges.end()
	await Promise.all([txids.promise, ranges.promise])

	await slackLog(listname, `created with ${count.txids} txids & ${count.ranges} ranges`, JSON.stringify({ keyTxids, keyRanges }))
	return count //for testing
}



/** updateFullTxidsRanges.  */
/** @deprecated use specific updates. this is not functional and throws error */
export const updateFullTxidsRanges = async () => {
	const msg = `ERROR! ${updateFullTxidsRanges.name} is deprecated and no longer functional`
	await slackLog(msg)
	throw new Error(msg)
}

