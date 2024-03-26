import { blockOwnerHistory } from '../../../../libs/block-owner/owner-blocking'
import pool from '../../../../libs/utils/pgClient'


let _lastWhitelist = -1
export async function checkForManuallyModifiedOwners() {
	let modified = false

	/** Manually added owners will not have their own block history table
	 * so we need to check for add_method = 'manual' owners in "owners_list" without their `owner_${owner}` table.
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
	console.info('new owners found', newOwners)

	let inserts = 0
	for (const owner of newOwners) {
		inserts += await blockOwnerHistory(owner, 'manual')
	}

	/** toggle modified if necessary */
	modified = newOwners.length > 0

	/** now check if whitelist was updated */
	const whitelist = await pool.query<{ owner: string, last_update: Date }>('SELECT owner, last_update FROM owners_whitelist')
	const lastUpdate = whitelist.rows.reduce((max, row) => row.last_update.valueOf() > max.last_update.valueOf() ? row : max, { owner: 'null', last_update: new Date(0) })

	console.debug('lastUpdate', JSON.stringify(lastUpdate))

	if (lastUpdate.last_update.valueOf() !== _lastWhitelist) {
		_lastWhitelist = lastUpdate.last_update.valueOf()
		modified = true
	}

	return modified
}

