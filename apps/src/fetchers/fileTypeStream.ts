import { fromStream } from 'file-type'
import { Readable } from 'stream';
import { logger } from '../common/utils/logger';
import { s3Delete } from './s3Stream';

export const filetypeStream = async(incoming: Readable, txid: string, dbMime: string)=> {
	const ft = await fromStream(incoming)
	if( ft && (
			ft.mime.startsWith('image')
			|| ft.mime.startsWith('video')
			|| ft.mime === 'application/xml' // `image/svg+xml` get interpreted as this
		) 
	){
		//do nothing
		if(process.env.NODE_ENV === 'test') logger(filetypeStream.name, `${txid} tested ok ${ft.mime}`)
		return true;
	}else{
		// if(process.env.NODE_ENV === 'test') 
		logger(filetypeStream.name, `${txid} original ${dbMime} rejected with ${ft?.mime}`)
		const mimeError = new Error('BAD_MIME')
		incoming.emit('error', mimeError)
		throw mimeError;
	}
}