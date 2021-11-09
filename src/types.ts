export interface TxScanned {
	txid: string
	content_type: string
	content_size: string //knex.bigInteger returns a string, convert to BigInt
}
export interface TxRecord extends TxScanned {
	readonly id: number
	flagged: boolean
	valid_data: boolean
	data_reason: 
		'oversized' 
		| 'partial' 
		| 'timeout' 
		| '404' 
		| 'corrupt' 
		| 'corrupt-maybe' 
		| 'unsupported' 
		| 'noop'
		| (string & {}) //intellisense hack

	nsfw_porn: number
	nsfw_sexy: number
	nsfw_hentai: number
	nsfw_neutral: number
	nsfw_drawings: number

	last_update_date: Date
}


export interface StateRecord {
	pname: 'scanner_position' | 'rating_position' | (string & {}) //nice hack for intellisense
	value: number
}

export type FfmpegError = {
	name: 'FfmpegError'
	message: string
	status: number
}