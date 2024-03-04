/**
 * Database types
 */

/* txs table */
export interface TxScanned {
	txid: string
	content_type: string
	content_size: string //knex.bigInteger returns a string, convert to BigInt
	height: number
	parent: string | null
	parents?: string[] | undefined
	owner: string | null
}
export interface TxRecord extends TxScanned, TxFlaggedOptions {
	flagged: boolean
	valid_data: boolean
	data_reason:
		'oversized'
		| 'partial'
		| 'partial-seed' //these vids have never occurred?
		| 'timeout'
		| '404'
		| 'corrupt'
		| 'corrupt-maybe'
		| 'unsupported'
		| 'noop'
		| 'mimetype'
		| 'negligible-data'
		| 'nodata'
		| 'MalformedXML-data'

	byteStart?: string	// convert to BigInt
	byteEnd?: string		// convert to BigInt

	last_update_date: Date
}
export interface TxFlaggedOptions {
	flag_type?: 'test' | 'matched' | 'classified'
	top_score_name?: string
	top_score_value?: number
}

export interface StateRecord {
	pname: 'indexer_pass1' | 'indexer_pass2' | 'seed_position' | 'owner_ingest'
	value: number
}

export interface HistoryRecord {
	total_txs: string
	unflagged: string
	indexer_pass1: number
	gql_height: number
}

export interface InflightsRecord {
	txid: string
	created_at?: Date
}

/**
 * Other types
 */

/** @deprecated */
export type FfmpegError = {
	name: 'FfmpegError'
	message: string
	status: number
}