import { blockOwnerHistory } from '../../../../libs/block-owner/owner-blocking'
import pg from '../../../../libs/utils/pgClient'


export const checkForManuallyAddedOwners = async () => {
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
			AND it.table_name IS NULL;	
	`
	const res = await pg.query<{ owner: string }>(query)

	const newOwners = res.rows.map((row) => row.owner)
	console.info('new owners found', newOwners)

	let inserts = 0
	for (const owner of newOwners) {
		inserts += await blockOwnerHistory(owner)
	}

	return newOwners.length
}