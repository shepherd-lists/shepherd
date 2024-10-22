import { s3HeadObject, s3PutObject, s3UploadReadable } from "../utils/s3-services"
import { slackLog } from "../utils/slackLog"
import pool from '../utils/pgClient'
import QueryStream from "pg-query-stream"
import { finished } from "stream/promises"
import { ByteRange, mergeErlangRanges } from "./merge-ranges"
import { performance } from 'perf_hooks'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'


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

export const assertLists = async () => {

	/** check if lists need to be created */

	if (!(await keyExists('addresses.txt'))) {
		console.info(`list 'addresses.txt' does not exist. creating...`)
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

/** not really certain if /addresses.txt is going to be a feature, but we use it interally now. */
export const updateAddresses = async () => {
	try {

		/** addresses should be pretty small, otherwise we might use streams */
		let { rows } = await pool.query(
			`SELECT owners_list.owner FROM owners_list
			LEFT JOIN owners_whitelist ON owners_list.owner = owners_whitelist.owner
			WHERE owners_whitelist IS NULL
			AND (add_method = 'manual' OR add_method = 'blocked')`
		)
		const owners = rows.map((row: { owner: string }) => row.owner)
		console.info(updateAddresses.name, 'updating addresses.txt... length', owners.length, JSON.stringify(owners))

		await s3PutObject(process.env.LISTS_BUCKET!, 'addresses.txt', owners.join('\n') + '\n')


		return owners.length

	} catch (err: unknown) {
		const e = err as Error
		slackLog(updateAddresses.name, `${e.name}:${e.message}`, JSON.stringify(e))
		throw e;
	}
}

/** updateFullTxidsRanges. */
let _inProgess_updateFullTxidsRanges = false
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

	const count = await lambdaInvoker()

	console.info(updateFullTxidsRanges.name, `total update time ${(performance.now() - t0).toFixed(0)} ms`)

	_inProgess_updateFullTxidsRanges = false

	return count; //something to indicate success
}

const lambdaInvoker = async () => {
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

			console.info(lambdaInvoker.name, `total ids ${count}`)
			return count;
		} catch (err: unknown) {
			const e = err as Error
			slackLog(lambdaInvoker.name, lambdaInvoker.name, `LAMBDA ERROR ${e.name}:${e.message}. retrying after 10 seconds`, JSON.stringify(e))
			await sleep(10_000)
			continue;
		}
	}
}
