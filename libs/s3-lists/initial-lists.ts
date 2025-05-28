import pool from '../utils/pgClient'
import QueryStream from 'pg-query-stream'
import { pipeline, Transform } from 'node:stream'
import { finished } from 'node:stream/promises'
import { ByteRange } from './merge-ranges'
import { UpdateItem, updateS3Lists } from './update-lists'






/** export for test only */
export const initListBasic = async ({
	Bucket,
	folder,
	query,
}: {
	Bucket: string;
	folder: string;
	query: string;
}
) => {

	console.debug(initListBasic.name, { Bucket, folder, query })

	interface RecordOutput { txid: string; byte_start: string; byte_end: string }

	const stream = new QueryStream(query, [], { highWaterMark: 200 })
	const cnn = await pool.connect()
	cnn.query(stream as QueryStream)

	const transformed = new Transform({
		objectMode: true,
		transform({ txid, byte_start, byte_end }: RecordOutput, encoding: BufferEncoding, callback: Function) {
			transformed.push({
				txid,
				range: [Number(byte_start), Number(byte_end)],
			})
			callback()
		}
	})

	stream.pipe(transformed)

	const counts = await updateS3Lists(folder, transformed)
	transformed.end()
	await finished(transformed)
	cnn.release()

	console.debug(initListBasic.name, folder, 'done')
	return counts //for tests
}

