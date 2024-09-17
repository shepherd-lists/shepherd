import { fromBuffer } from 'file-type' //16.5.4 for cjs
import { Readable } from 'stream'
import { FetchersStatus } from '../common/constants'
import { dbWrongMimeType } from '../common/utils/db-update-txs'
import { logger } from '../common/utils/logger'
import { s3Delete } from './s3Services'

export const filetypeCheck = async(incoming: Readable, buffer: ArrayBuffer, txid: string, dbMime: string)=> {

	const ft = await fromBuffer(buffer)

	if(ft && ft.mime === 'application/xml' && dbMime === 'image/svg+xml'){
		return true
	}

	if(
		ft?.mime.startsWith('image')
		|| ft?.mime.startsWith('video')
		|| ft?.mime.startsWith('audio')
		|| ft === undefined // sometimes file-type doesn't detect, so we'll assume it's ok and catch problems later
	){

		// do nothing
		// if(process.env.NODE_ENV === 'test')
		logger(filetypeCheck.name, `${txid} tested ok ${ft?.mime}`)

		return true

	}else{

		// throw errors and cleanup
		logger(filetypeCheck.name, `${txid} original '${dbMime}' rejected with '${ft?.mime}'`)

		const status: FetchersStatus = 'BAD_MIME'
		const mimeError = new Error(status)
		incoming.emit('error', mimeError)

		// make sure s3 object is removed (applies to smaller files which may have fully uploaded before error emitted).
		await s3Delete(txid)

		await dbWrongMimeType(txid, ft?.mime)

	}
}