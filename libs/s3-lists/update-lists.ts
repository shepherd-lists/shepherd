import { s3HeadObject, s3PutObject, s3UploadReadable, s3UploadStream } from "../utils/s3-services"
import { slackLog } from "../utils/slackLog"
import pool from '../utils/pgClient'
import QueryStream from "pg-query-stream"
import { finished } from "stream/promises"



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

	if (!(await keyExists('blacklist.txt')) || !(await keyExists('rangelist.txt'))) {
		console.info(`list 'blacklist.txt' or 'rangelist.txt' does not exist. creating both...`)
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
	const s3Ranges = s3UploadReadable(LISTS_BUCKET, 'rangelist.txt')

	let count = 0
	for await (const row of flaggedStream) {
		// console.debug('row', row)
		count++
		s3Txids.write(`${row.txid}\n`)
		if (!row.byteStart) {
			slackLog(updateFullTxidsRanges.name, `bad byte-range`, JSON.stringify(row))
			continue;
		} else if (row.byteStart === '-1') {
			console.info(updateFullTxidsRanges.name, `bad byte-range`, JSON.stringify(row))
			continue;
		}
		s3Ranges.write(`${row.byteStart},${row.byteEnd}\n`)
	}
	console.debug(updateFullTxidsRanges.name, 'DEBUG flaggedStream', count)
	console.debug(updateFullTxidsRanges.name, 'DEBUG ownerStreams.length', ownerStreams.length)
	let i = 0
	for (const stream of ownerStreams) {
		console.debug(updateFullTxidsRanges.name, 'DEBUG ownerStreams', ownerTablenames[i++])
		for await (const row of stream) {
			// console.debug('row', row)
			count++
			s3Txids.write(`${row.txid}\n`)
			if (!row.byte_start) {
				slackLog(updateFullTxidsRanges.name, `bad byte-range`, JSON.stringify(row))
				continue;
			} else if (row.byte_start === '-1') {
				console.info(updateFullTxidsRanges.name, `bad byte-range`, JSON.stringify(row))
				continue;
			}
			s3Ranges.write(`${row.byte_start},${row.byte_end}\n`)
		}
	}

	console.info('count', count)

	client.release() //release connection back to pool

	/** close the output streams */
	s3Txids.end()
	s3Ranges.end()
	await Promise.all([
		finished(s3Txids),
		finished(s3Ranges),
	])

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


