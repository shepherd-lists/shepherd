import { Knex } from "knex";

/**
 * -= HIDDEN REFERENCE =-
 * "txs" table currently looks like this:
 * 
 * arblacklist=# \d txs
 * 																	Table "public.txs"
 * 			Column      |           Type           | Collation | Nullable |      Default      
 * ------------------+--------------------------+-----------+----------+-------------------
 * txid             | character(43)            |           | not null | 
 * content_type     | text                     |           | not null | 
 * content_size     | bigint                   |           | not null | 
 * flagged          | boolean                  |           |          | 
 * valid_data       | boolean                  |           |          | 
 * data_reason      | text                     |           |          | 
 * last_update_date | timestamp with time zone |           |          | CURRENT_TIMESTAMP
 * height           | integer                  |           |          | 
 * flag_type        | text                     |           |          | 
 * top_score_name   | text                     |           |          | 
 * top_score_value  | real                     |           |          | 
 * parent           | character(43)            |           |          | 
 * byteStart        | bigint                   |           |          | 
 * byteEnd          | bigint                   |           |          | 
 * parents          | character(43)[]          |           |          | 
 * Indexes:
 * 		"txs_pkey" PRIMARY KEY, btree (txid)
 * 		"txs_flagged" btree (flagged) WHERE flagged = true
 * 		"txs_flagged_null" btree (flagged) WHERE flagged IS NULL
 * 		"txs_height_index" btree (height)
 * 		"txs_top_score_value_desc" btree (top_score_value DESC NULLS LAST)
 * 		"txs_valid_data_idx" btree (valid_data) WHERE valid_data IS NULL
 * Check constraints:
 * 		"cc_txid" CHECK (char_length(txid) = 43)
 * Referenced by:
 * 		TABLE "inflights" CONSTRAINT "inflights_txid_foreign" FOREIGN KEY (txid) REFERENCES txs(txid)
 */

export async function up(knex: Knex): Promise<void> {

	/** clone the columns from "txs" (see above comment) */
	await knex.schema.raw('CREATE TABLE inbox_txs (LIKE txs INCLUDING CONSTRAINTS INCLUDING INDEXES)')

	/** set the fillfactor. all rows get updated once and then deleted */
	await knex.schema.raw('ALTER TABLE inbox_txs SET (fillfactor = 50)')

	/** change inflights foreign key to point to inbox_txs table */
	await knex('inflights').delete() //wipe `inflights` as we won't have references to the new, empty `inbox_txs` table
	await knex.schema.raw('ALTER TABLE inflights DROP CONSTRAINT inflights_txid_foreign')
	await knex.schema.raw('ALTER TABLE inflights ADD CONSTRAINT inflights_txid_foreign FOREIGN KEY (txid) REFERENCES inbox_txs(txid)')

}

export async function down(knex: Knex): Promise<void> {
	/** drop and re-add inflights foreign key */
	await knex.schema.raw('ALTER TABLE inflights DROP CONSTRAINT inflights_txid_foreign')
	await knex.schema.raw('ALTER TABLE inflights ADD CONSTRAINT inflights_txid_foreign FOREIGN KEY (txid) REFERENCES txs(txid)')
	/** drop inbox_txs table */
	await knex.schema.dropTableIfExists('inbox_txs')
}

