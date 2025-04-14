import { s3HeadObject, s3PutObject, s3ObjectTagging, s3UploadReadable } from "../utils/s3-services"
import { slackLog } from "../utils/slackLog"
import pool from '../utils/pgClient'
import { performance } from 'perf_hooks'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { ByteRange } from "./merge-ranges"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const LISTS_BUCKET = process.env.LISTS_BUCKET as string
const FN_LISTS = process.env.FN_LISTS as string


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
export const assertLists = async () => {

	/** check if lists need to be created */

	if (!(await keyExists('addresses.txt') || !await s3GetTag('addresses.txt', 'SHA-1'))) {
		console.info(`list 'addresses.txt' or it's SHA-1 hash does not exist. creating...`)
		console.info(
			'addresses.txt count',
			await updateAddresses()
		)
	}


	if (
		!(await keyExists('blacklist.txt'))
		|| !(await keyExists('txidflagged.txt'))
		|| !(await keyExists('txidowners.txt'))
		|| !(await keyExists('rangelist.txt'))
		|| !(await keyExists('rangeflagged.txt'))	//shep-v
		|| !(await keyExists('rangeowners.txt'))	//shep-v
	) {
		console.info(`list 'blacklist.txt', 'rangelist.txt', txidflagged.txt, txidowners.txt, rangeflagged.txt, etc. does not exist. recreating all...`)
		console.info(
			'blacklist.txt|rangelist.txt count',
			await updateFullTxidsRanges()
		)
	}

	console.info('done assertLists')
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
			slackLog(listname, `:warning: skipped ${txid}`, JSON.stringify({ range }))
		}
	}

	txids.end()
	ranges.end()
	await Promise.all([txids.promise, ranges.promise])

	await slackLog(listname, `created with ${count.txids} txids & ${count.ranges} ranges`, JSON.stringify({ keyTxids, keyRanges }))
	return count //for testing
}

/** updateFullTxidsRanges.  */
let _inProgess_updateFullTxidsRanges = false
/** @deprecated use specific updates */
export const updateFullTxidsRanges = async () => {

	/** this is a big operation, avoid parallel runs */
	if (_inProgess_updateFullTxidsRanges) {
		console.info(`${updateFullTxidsRanges.name} is already in progress.`)
		return 'inProgess';
	}
	_inProgess_updateFullTxidsRanges = true

	/** inputs:
	 * - flagged from txs
	 * - all from owners_{address} tables
	 */

	/** prepare input streams */

	const t0 = performance.now()

	const count = await fnListsInvoker()

	console.info(updateFullTxidsRanges.name, `total update time ${(performance.now() - t0).toFixed(0)} ms`)

	_inProgess_updateFullTxidsRanges = false

	return count; //something to indicate success
}

const fnListsInvoker = async () => {
	const lambdaClient = new LambdaClient({})

	while (true) {
		try {
			const res = await lambdaClient.send(new InvokeCommand({
				FunctionName: FN_LISTS,
				Payload: JSON.stringify({ dummy: 0 }),
				InvocationType: 'RequestResponse',
			}))
			if (res.FunctionError) {
				let payloadMsg = ''
				try { payloadMsg = new TextDecoder().decode(res.Payload) }
				catch (e) { payloadMsg = 'error decoding Payload with res.FunctionError' }
				throw new Error(`Lambda error '${res.FunctionError}', payload: ${payloadMsg}`)
			}

			const count: number = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))

			console.info(fnListsInvoker.name, `total ids ${count}`)
			return count;
		} catch (err: unknown) {
			const e = err as Error
			slackLog(fnListsInvoker.name, fnListsInvoker.name, `LAMBDA ERROR ${e.name}:${e.message}. retrying after 10 seconds`, JSON.stringify(e))
			await sleep(10_000)
			continue;
		}
	}
}
