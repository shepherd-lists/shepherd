import pool from '../../libs/utils/pgClient'
import QueryStream from "pg-query-stream"
import { slackLog } from '../../libs/utils/slackLog'
import { s3UploadReadable } from '../../libs/utils/s3-services'
import { ByteRange } from '../../libs/s3-lists/merge-ranges'

// type WriteableWithPromise = ReturnType<typeof s3UploadReadable>


export const processAddonTable = async (config: {
	LISTS_BUCKET: string,
	tablename: string,
	highWaterMark: number,
	ranges: ByteRange[], //all get merged
}) => {

	const { LISTS_BUCKET, tablename, highWaterMark, ranges } = config
	const prefix = tablename.split('_')[0] //e.g. my_txs => my
	console.info(tablename, 'stream starting')

	/** open s3 upload stream */
	const s3AddonTxids = s3UploadReadable(LISTS_BUCKET, `${prefix}/txids.txt`)
	const s3AddonRanges = s3UploadReadable(LISTS_BUCKET, `${prefix}/ranges.txt`)

	/** set up db cnn */
	let query = `SELECT txid, "byte_start", "byte_end" FROM "${tablename}" WHERE flagged = true`
	const stream: AsyncIterable<{ txid: string; byte_start: string; byte_end: string }> = new QueryStream(query, [], { highWaterMark })
	const cnn = await pool.connect()
	cnn.query(stream as QueryStream)

	/** loop thru table */
	let c = 0
	const t = Date.now()
	try {
		for await (const row of stream) {
			// console.debug('row', row)
			++c
			s3AddonTxids.write(`${row.txid}\n`)
			if (!row.byte_start) {
				slackLog(tablename, `missing byte-range`, JSON.stringify(row))

				continue;
			} else if (row.byte_start === '-1') {
				console.info(`${tablename} bad byte-range`, JSON.stringify(row))
				continue;
			}
			s3AddonRanges.write(`${row.byte_start},${row.byte_end}\n`)
			ranges.push([+row.byte_start, +row.byte_end])
		}

	} finally {
		/** release db cnn */
		cnn.release()

		/** end s3 streams and await */
		const s3s = [s3AddonTxids, s3AddonRanges]
		await Promise.all(s3s.map(async s => {
			s.end()
			await s.promise
		}))

		/** return count */
		console.info(`${tablename}  stream done. ${c} items in ${(Date.now() - t).toLocaleString()}ms`)
		return c;
	}
}
