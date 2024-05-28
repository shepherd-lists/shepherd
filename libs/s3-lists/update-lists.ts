import { s3HeadObject, s3PutObject, s3UploadReadable } from "../utils/s3-services"
import { slackLog } from "../utils/slackLog"
import pool from '../utils/pgClient'
import QueryStream from "pg-query-stream"
import { finished } from "stream/promises"
import { ByteRange, mergeErlangRanges } from "./merge-ranges"
import { performance } from 'perf_hooks'



const LISTS_BUCKET = process.env.LISTS_BUCKET as string


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

/** updateFullTxidsRanges. 
 * - N.B. if the /addresses.txt feature is introduced  we can omit owner_* from /blacklists.txt */
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

	const flaggedStream = new QueryStream('SELECT txid, "byteStart", "byteEnd" FROM txs WHERE flagged = true', [])

	const ownerTablenames = await getOwnersTablenames()
	console.debug(updateFullTxidsRanges.name, `DEBUG ownersTablenames ${JSON.stringify(ownerTablenames)}`)

	const ownerStreams: QueryStream[] = []
	ownerTablenames.map((tablename) => ownerStreams.push(
		new QueryStream(`SELECT txid, byte_start, byte_end FROM "${tablename}"`)
	))

	/** N.B. need to handle the connection manually for pg-query-stream */
	const client = await pool.connect() //using one connection for sequential queries
	client.query(flaggedStream)
	ownerStreams.map((stream) => client.query(stream))

	/** prepare output streams to s3 */
	const s3Txids = s3UploadReadable(LISTS_BUCKET, 'blacklist.txt')
	const s3TxidFlagged = s3UploadReadable(LISTS_BUCKET, 'txidflagged.txt')
	const s3TxidOwners = s3UploadReadable(LISTS_BUCKET, 'txidowners.txt')
	const s3RangeFlagged = s3UploadReadable(LISTS_BUCKET, 'rangeflagged.txt')
	const s3RangesOwners = s3UploadReadable(LISTS_BUCKET, 'rangeowners.txt')

	/** rangelist needs sort & merge processing before upload */
	const ranges: Array<ByteRange> = []

	const t1 = performance.now()
	console.info(`prepared streams in ${(t1 - t0).toFixed(0)} ms`)

	let count = 0
	for await (const row of flaggedStream) {
		// console.debug('row', row)
		count++
		s3Txids.write(`${row.txid}\n`)
		s3TxidFlagged.write(`${row.txid}\n`)
		if (!row.byteStart) {
			slackLog(updateFullTxidsRanges.name, `bad byte-range`, JSON.stringify(row))
			continue;
		} else if (row.byteStart === '-1') {
			console.info(updateFullTxidsRanges.name, `bad byte-range`, JSON.stringify(row))
			continue;
		}
		s3RangeFlagged.write(`${row.byteStart},${row.byteEnd}\n`)
		ranges.push([row.byteStart, row.byteEnd])
	}
	s3RangeFlagged.end()

	console.debug(updateFullTxidsRanges.name, 'DEBUG flaggedStream', count)
	console.debug(updateFullTxidsRanges.name, 'DEBUG ownerStreams.length', ownerStreams.length)
	let i = 0
	for (const stream of ownerStreams) {
		console.debug(updateFullTxidsRanges.name, 'DEBUG ownerStreams', ownerTablenames[i++])
		for await (const row of stream) {
			// console.debug('row', row)
			count++
			s3Txids.write(`${row.txid}\n`)
			s3TxidOwners.write(`${row.txid}\n`)
			if (!row.byte_start) {
				slackLog(updateFullTxidsRanges.name, `missing byte-range`, JSON.stringify(row))
				continue;
			} else if (row.byte_start === '-1') {
				console.info(updateFullTxidsRanges.name, `bad byte-range`, JSON.stringify(row))
				continue;
			}
			s3RangesOwners.write(`${row.byte_start},${row.byte_end}\n`)
			ranges.push([row.byte_start, row.byte_end])
		}
	}
	console.info(updateFullTxidsRanges.name, 'count', count)
	client.release() //release connection back to pool

	/** close the output streams */
	s3Txids.end()
	s3TxidFlagged.end()
	s3TxidOwners.end()
	s3RangesOwners.end()
	await Promise.all([
		finished(s3Txids),
		finished(s3TxidFlagged),
		finished(s3TxidOwners),
		finished(s3RangeFlagged),
		finished(s3RangesOwners),
	])

	const t2 = performance.now()
	console.info(updateFullTxidsRanges.name, `finished txids in ${(t2 - t1).toFixed(0)} ms`)

	/** process ranges and write out */
	const s3Ranges = s3UploadReadable(LISTS_BUCKET, 'rangelist.txt')
	for await (const range of mergeErlangRanges(ranges)) {
		s3Ranges.write(`${range[0]},${range[1]}\n`)
	}
	ranges.length = 0 //side-effects, dont use again
	s3Ranges.end()
	await finished(s3Ranges)

	console.info(updateFullTxidsRanges.name, `total update time ${(performance.now() - t0).toFixed(0)} ms`)

	_inProgess_updateFullTxidsRanges = false

	return count; //something to indicate success
}

/** get a list of all the tables with blocked owners items.
 * - N.B. omit whitelisted owners
 */
const getOwnersTablenames = async () => {

	const { rows } = await pool.query<{ tablename: string }>(`
		SELECT tablename FROM pg_catalog.pg_tables
		WHERE tablename LIKE 'owner\\_%'
		AND NOT EXISTS (
				SELECT 1 FROM owners_whitelist
				WHERE pg_catalog.pg_tables.tablename = 'owner_' || REPLACE(owners_whitelist.owner, '-', '~')
		);
	`)

	return rows.map(row => row.tablename)
}
