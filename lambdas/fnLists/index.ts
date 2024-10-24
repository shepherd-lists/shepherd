import pool from '../../libs/utils/pgClient'
import QueryStream from "pg-query-stream"
import { finished } from 'stream/promises'
import { slackLog } from '../../libs/utils/slackLog'
import { s3UploadReadable } from '../../libs/utils/s3-services'
import { ByteRange, mergeErlangRanges } from "../../libs/s3-lists/merge-ranges"



const LISTS_BUCKET = process.env.LISTS_BUCKET as string
if (!LISTS_BUCKET) throw new Error('LISTS_BUCKET is not set')


export const handler = async (event: any) => {
	console.info(JSON.stringify(event, null, 2))

	const t0 = performance.now()

	const flaggedStream = new QueryStream('SELECT txid, "byteStart", "byteEnd" FROM txs WHERE flagged = true', [])


	/** N.B. need to handle the connection manually for pg-query-stream */
	const cnnFlagged = await pool.connect() //using one connection per query
	cnnFlagged.query(flaggedStream)

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
			slackLog(`bad byte-range`, JSON.stringify(row))
			continue;
		} else if (row.byteStart === '-1') {
			console.info(`bad byte-range`, JSON.stringify(row))
			continue;
		}
		s3RangeFlagged.write(`${row.byteStart},${row.byteEnd}\n`)
		ranges.push([+row.byteStart, +row.byteEnd])
	}
	s3RangeFlagged.end()
	cnnFlagged.release() //release connection back to pool

	console.debug('flaggedStream', count)

	/** process owner tables */
	const ownerTablenames = await getOwnersTablenames()
	console.debug(`ownersTablenames, count=${ownerTablenames.length} ${JSON.stringify(ownerTablenames)}`)

	const cnns = await Promise.all(ownerTablenames.map(async tablename => {
		const stream = new QueryStream(`SELECT txid, byte_start, byte_end FROM "${tablename}"`)
		const cnn = await pool.connect() //1 cnn per table
		cnn.query(stream)
		console.debug('ownerStream', tablename)
		for await (const row of stream) {
			// console.debug('row', row)
			count++
			s3Txids.write(`${row.txid}\n`)
			s3TxidOwners.write(`${row.txid}\n`)
			if (!row.byte_start) {
				slackLog(`missing byte-range`, JSON.stringify(row))
				continue;
			} else if (row.byte_start === '-1') {
				console.info(`bad byte-range`, JSON.stringify(row))
				continue;
			}
			s3RangesOwners.write(`${row.byte_start},${row.byte_end}\n`)
			ranges.push([+row.byte_start, +row.byte_end])
		}
		return cnn;
	}))

	console.info('count', count)


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
	cnns.map(cnn => cnn.release()) //release all db connections

	const t2 = performance.now()
	console.info(`finished txids in ${(t2 - t1).toFixed(0)} ms`)

	/** process ranges and write out */
	const s3Ranges = s3UploadReadable(LISTS_BUCKET, 'rangelist.txt')
	for await (const range of mergeErlangRanges(ranges)) {
		s3Ranges.write(`${range[0]},${range[1]}\n`)
	}
	ranges.length = 0 //side-effects, dont use again
	s3Ranges.end()
	await finished(s3Ranges)

	return count
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
