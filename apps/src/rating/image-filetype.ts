import filetype from 'file-type'
import { logger } from '../utils/logger'
import { dbNoMimeType, dbWrongMimeType } from './db-update-txs'

export const checkImageMime = async(buffer: Uint8Array, types: string[], txid: string)=> {
	const type = await filetype.fromBuffer(buffer)
	if(type === undefined){
		logger(txid, 'no mime-type detected. marking no mime')
		await dbNoMimeType(txid)
		return false;
	}
	if(types.includes(type.mime)){
		return true;
	}
	logger(txid, 'wrong mime-type. re-queueing for', type.mime)
	await dbWrongMimeType(txid, type.mime)
	return false;
}

export const getImageMime = async(buffer: Uint8Array)=> {
	const type = await filetype.fromBuffer(buffer)
	if(type === undefined) return undefined
	return type.mime;
}