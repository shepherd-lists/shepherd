import { blockOwnerHistory, queueBlockOwner } from '../../../../libs/block-owner/owner-blocking'
import { updateAddresses } from '../../../../libs/s3-lists/update-lists'
import pool from '../../../../libs/utils/pgClient'


let _lastWhitelist = -1
export async function checkForManuallyModifiedOwners() {
	let txidsModified = false
	let addressesModified = false

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
	addressesModified = newOwners.length > 0

	/** now check if whitelist was updated */
	const whitelist = await pool.query<{ owner: string, last_update: Date }>('SELECT owner, last_update FROM owners_whitelist')
	const lastUpdate = whitelist.rows.reduce((max, row) => row.last_update.valueOf() > max.last_update.valueOf() ? row : max, { owner: 'null', last_update: new Date(0) })

	console.debug(checkForManuallyModifiedOwners.name, 'whitelist lastUpdate', JSON.stringify(lastUpdate))

	if (lastUpdate.last_update.valueOf() !== _lastWhitelist) {
		_lastWhitelist = lastUpdate.last_update.valueOf()
		addressesModified = true
		txidsModified = true //as might need to remove some txids from the lists
	}

	if (addressesModified) {
		console.info(checkForManuallyModifiedOwners.name, 'blocked owners modified', newOwners, 'updating /addresses.txt')
		await updateAddresses()
	} else {
		console.info(checkForManuallyModifiedOwners.name, 'no new owners found')
	}

	/** queue any new owners */
	let inserts = 0
	for (const owner of newOwners) {
		inserts += await queueBlockOwner(owner, 'manual')
	}

	/** toggle modified if necessary */
	txidsModified ||= inserts > 0

	return txidsModified // this is used to trigger a full update of the lists
}

