import { Transform } from 'node:stream'
import { queueBlockOwner } from '../../../../libs/block-owner/owner-blocking'
import { ownerToOwnerTablename } from '../../../../libs/block-owner/owner-table-utils'
import { updateAddresses, UpdateItem, updateS3Lists } from '../../../../libs/s3-lists/update-lists'
import pool from '../../../../libs/utils/pgClient'
import QueryStream from 'pg-query-stream'
import { finished } from 'node:stream/promises'


export async function checkForManuallyModifiedOwners() {

	/** Manually added owners will not have their own block history table
	 * so we need to check "owners_list" for owners with add_method = 'manual' && no `owner_${owner}` table.
	 * ..and dont forget to exclude owners in the whitelist
	 */
	const query = `
		SELECT ol.owner
		FROM owners_list ol
		LEFT JOIN information_schema.tables it 
			ON it.table_name = 'owner_' || REPLACE(ol.owner, '-', '~')
			AND it.table_schema = 'public'
		WHERE ol.add_method = 'manual'
			AND it.table_name IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM owners_whitelist
				WHERE owners_whitelist.owner = ol.owner
			)	
	`
	const res = await pool.query<{ owner: string }>(query)

	const newOwners = res.rows.map((row) => row.owner)

	/** now check if whitelist was updated 
	 * - we only need to check when there's a new whitelist, that has a previously blocked history
	 * - we should also remove this owner_table so this query returns false next time
	 */
	const newWhitelistedOwners = await pool.query<{ owner: string }>(`
		SELECT ow.owner
		FROM owners_whitelist ow
		WHERE EXISTS (
				SELECT 1
				FROM information_schema.tables t
				WHERE t.table_schema = 'public'
				AND t.table_name = 'owner_' || replace(ow.owner, '-', '~')
		)
	`)
	const newWhitelistedOwnersCount = Number(newWhitelistedOwners.rowCount)

	console.debug(checkForManuallyModifiedOwners.name, 'modified whitelisted owners', JSON.stringify(newWhitelistedOwnersCount))

	if (newWhitelistedOwnersCount > 0) {
		await Promise.all(newWhitelistedOwners.rows.map(async ({ owner }) => {
			const tablename = ownerToOwnerTablename(owner)

			/** stream the table as remove ops for s3 lists */
			const cnn = await pool.connect()
			const query = `SELECT txid, byte_start, byte_end FROM "${tablename}"`
			const stream = new QueryStream(query, [], { highWaterMark: 200 })
			cnn.query(stream)

			const transformed = new Transform({
				objectMode: true,
				transform({ txid, byte_start, byte_end }, encoding, callback) {
					transformed.push({
						txid,
						range: [Number(byte_start), Number(byte_end)],
						op: 'remove',
					} as UpdateItem)
					callback()
				}
			})
			stream.pipe(transformed)

			await updateS3Lists('owners/', transformed)
			transformed.end()
			await finished(transformed)
			cnn.release()

			/** delete the whitelisted table when done */
			await pool.query(`DROP TABLE "${tablename}"`)

			console.info(checkForManuallyModifiedOwners.name, `dropped table "${tablename}"`)
		}))
	}

	/** this fn checks internally if it needs updating */
	const addrUpdated = await updateAddresses()
	console.info(checkForManuallyModifiedOwners.name, addrUpdated ? 'addresses updated' : 'addresses unchanged')

	/** queue any new owners */
	for (const owner of newOwners) {
		await queueBlockOwner(owner, 'manual')
	}
}
