/**
CREATE TABLE txs (
	id SERIAL PRIMARY KEY,
	txid CHARACTER(43) UNIQUE NOT NULL,
	content_type TEXT NOT NULL,
	content_size INTEGER NOT NULL,
	flagged BOOLEAN,
	valid_data BOOLEAN,
	data_reason TEXT,
	nsfw_porn real,
	nsfw_sexy real,
	nsfw_hentai real,
	nsfw_neutral real,
	nsfw_drawings real,
	last_update_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT cc_id CHECK ((char_length(txid) = 43))
);
 */

export interface TxScanned {
	txid: string
	content_type: string
	content_size: number
}
export interface TxRecord extends TxScanned {
	readonly id: number
	flagged: boolean
	valid_data: boolean
	data_reason: 'oversized' | 'partial' | 'timeout' | '404' | 'corrupt' | 'corrupt-maybe' | 'unsupported' | (string & {}) //intellisense hack

	nsfw_porn: number
	nsfw_sexy: number
	nsfw_hentai: number
	nsfw_neutral: number
	nsfw_drawings: number

	last_update_date: Date
}

/**
 CREATE TABLE states (
 	id SERIAL PRIMARY KEY,
 	pname TEXT NOT NULL,
 	blocknumber INT NOT NULL
 );
   INSERT INTO states(pname, blocknumber) 
  VALUES 
 	 ('scanner_position', 0),
 	 ('rating_position', 0);
 */

export interface StateRecord {
	pname: 'scanner_position' | 'rating_position' | (string & {}) //nice hack for intellisense
	value: number //blocknumber is a bad name
}

export type FfmpegError = {
	name: 'FfmpegError'
	message: string
	status: number
}