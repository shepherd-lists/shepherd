import { Readable } from "stream"
import type { TxFlaggedOptions } from "../types"

export interface FilterResult extends TxFlaggedOptions {
	flagged: boolean // main output: whether the image is filtered or not

	/** @deprecated */
	scores?: string  //remove later
}

/* Feedback error types to the host app. Host may process image and try submitting to plugin again. */
export interface FilterErrorResult {
	flagged: undefined
	data_reason: 
		'oversized'       // oversized compressed png files that cannot be opened by most image libraries. 
		| 'partial'       // partial image that library cannnot open
		| 'unsupported'   // unsupported file type (your plugin is expected to handle jpeg/png/gif at a minimum)
		| 'corrupt'       // image data is corrupt
		| 'corrupt-maybe' // image data is corrupt, but can be displayed by a browser
		| 'noop'					// no operation
		| (string & {})
	err_message?: string // optional error message
}


export interface FilterPluginInterface {
	/**
	 * init()
	 * This will be called early to instantiate your rater plugin. You should do things like load AI models here.
	 * Consider using Singleton/ESM module level variables/static coding patterns to conserve ram.
	 */
	init(): Promise<void>
	/**
	 * @param buffer - buffer containing image data. Already checked for mime-type, but actual data is often corrupt
	 * @param mimetype - the mime-type indicated
	 * @param txid - the Arweave txid, useful for debugging against the actual served data
	 */
	checkImage(buffer: Buffer, mimetype: string, txid: string): Promise<FilterResult | FilterErrorResult>
}

export interface APIFilterResult {
	txid: string
	filterResult: FilterResult | FilterErrorResult
}

export interface StreamPluginInterface {
	checkStream(read: Readable, mimetype: string, txid: string):Promise<string | Error> 
}