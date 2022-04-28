import { PassThrough } from 'stream'
import axios from "axios"
import { NO_DATA_TIMEOUT, NO_STREAM_TIMEOUT } from "../constants"
import { logger } from "./logger"
import { IncomingMessage } from 'http'

//used in batches
export const axiosDataTimeout = async(url: string)=> {
	
	/**
	 * Axios never times out if the connection is opened correctly with non-zero Content-Length, but no data is ever returned.
	 * The workaround is to set a timeout, cancel the request, and throw an error.
	 */

	const source = axios.CancelToken.source()
	let timer: NodeJS.Timeout
	process.nextTick(()=>{
		timer = setTimeout( ()=> {
			if(process.env.NODE_ENV==='test') logger('** DEBUG **', 'entered setTimeout for', url)
			source.cancel()
		}, NO_DATA_TIMEOUT )
	})

	try{
		
		const res = await axios.get(url, {
			cancelToken: source.token,
			responseType: 'arraybuffer',
			//  onDownloadProgress: ()=> clearTimeout(timer), //browser only
			// timeout: 0, //default 0
		})
		clearTimeout(timer!)

		return res.data

	}catch(e:any){
		if(e.response || e.code){
			clearTimeout(timer!)
			throw(e)
		}
		throw new Error(`Timeout of ${NO_DATA_TIMEOUT}ms exceeded`)
	}
}

//to be used on individual, unbatched urls (the above axiosDataTimeout isn't 100% perfect, so can use below for second pass, for example)
export const axiosStreamTimeout = async(url: string)=> {
	return new Promise<NodeJS.ReadableStream>( async(resolve, reject) => {
		
		const returnOut = new PassThrough()

		const source = axios.CancelToken.source()
		let timer: NodeJS.Timeout | null = null

		process.nextTick(()=>{ 
			timer = setTimeout( ()=>{
				source.cancel()
				returnOut.destroy()
				reject(new Error(`Timeout of ${NO_STREAM_TIMEOUT}ms exceeded`))
			}, NO_STREAM_TIMEOUT )
		})
	
		try{
			
			const { data } = await axios.get(url, {
				cancelToken: source.token,
				responseType: 'stream',
			})
			const stream: IncomingMessage = data
			
			// let buffers: Uint8Array[] = []
	
			stream.on('data', (buffer: Uint8Array)=>{
				clearTimeout(timer!)
				// buffers.push(buffer)
			})

			stream.pipe(returnOut)
	
			// stream.on('end', ()=>{
			// 	const data = Buffer.concat(buffers)
			// 	resolve(data)
			// 	return;
			// })

			stream.on('error', (e: any)=>{
				logger('READ STREAM ERROR')
				returnOut.destroy()
				reject(e)
			})
			
		}catch(e:any){
			clearTimeout(timer!)
			returnOut.destroy()
			reject(e)
		}

		resolve(returnOut)
	})
}