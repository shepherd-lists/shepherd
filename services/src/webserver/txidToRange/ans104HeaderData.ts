/**
 * NOTICE
 * This file uses code inspired from the Apache 2.0 licensed code permalinked here 
 * (https://github.com/Bundlr-Network/arbundles/blob/c6aa659a63d386066504e7cd8cab415d422d4f8f/stream/index.ts#L1-L195).
 * The license of the shepherd repo is LGPL-3.0-or-later which is compatible.
 */
import { ReadableStreamDefaultReader } from 'stream/web'
import Arweave from 'arweave'
import { fetchRetryConnection } from './fetch-retry'
import { HOST_URL } from '../../common/constants'
import memoize from 'micro-memoize'


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

//bundlr style conversion 
const byteArrayToNumber = (buffer: Uint8Array): number => {
	let value = 0
	for (let i = buffer.length - 1; i >=0; --i) {
		value = value * 256 + buffer[i]
	}
	return value
}

const readEnoughBytes = async(
  reader: ReadableStreamDefaultReader,
  buffer: Uint8Array,
  length: number,
): Promise<Uint8Array> => {
	// process.env['NODE_ENV'] === 'test' && console.log(buffer.byteLength) 

	if (buffer.byteLength > length) return buffer!;

	let { done, value } = await reader.read();

	if (done && !value) throw new Error(`Invalid stream buffer`);

	//concat and clean up old buffers for gc
	const joined = concatByteArray(buffer, value)
	buffer = null as any
	value = null

	return readEnoughBytes(reader, joined, length);
}
const concatByteArray = (a: Uint8Array, b: Uint8Array) => {
	const temp = new Uint8Array(a.byteLength + b.byteLength) 
	temp.set(a) 
	temp.set(b, a.byteLength)
	return temp;
}

/* handle errors during the stream */
const fetchHeader = async(parent: string)=> {
	while(true){
		let reader: ReadableStreamDefaultReader<any>
		try{
			/* start the stream connection */

			let header = new Uint8Array(0)

			const { aborter, res: { status, body: stream} } = await fetchRetryConnection(`${HOST_URL}/${parent}`)
			//pass 404s up
			if(status === 404) return {
				status,
				header,
				numDataItems: -1,
			}
			
			/* fetch the bytes we're interested in */
		
			//read bytes for numDataItems and calculate header size
			reader = stream!.getReader()
			header = await readEnoughBytes(reader, header, 32)
			const numDataItems = byteArrayToNumber(header.slice(0, 32))
			const totalHeaderLength = 64 * numDataItems + 32
			
			if(process.env['NODE_ENV'] === 'test') console.log(header.length, {numDataItems, totalHeaderLength})
			
			//read bytes for the rest of the header index
			header = await readEnoughBytes(reader, header, totalHeaderLength)
		
			if(process.env['NODE_ENV'] === 'test') console.log(header.length)
		
			/* close the stream & return results */
			aborter!.abort()
			reader.releaseLock()
			stream?.cancel() //thrice to be sure?

			return {
				status,
				header,
				numDataItems,
			}

		}catch(e){
			reader!.releaseLock()
			//can we just retry everything?
			const retryMs = 10_000
			console.log(fetchHeader.name, `Error for '${parent}'. Retrying in ${retryMs} ms...`)
			console.log(e)
			await sleep(retryMs)
		}
	}
}

const ans104HeaderDataUnmemoized = async(parent: string)=> {

	/* get data stream */	

	let { status, header, numDataItems } = await fetchHeader(parent)
	if(status === 404) return {
		status, 
		numDataItems,
		diIds: [] as string[],
		diSizes: [] as number[],
	}
	
	/* process the return data */

	const diIds: string[] = []
	const diSizes: number[] = []

	for(let i = 0; i < numDataItems; i++) {
		const base = 32 + i * 64
		const nextSize = byteArrayToNumber(header.subarray(
			base,
			base + 32,
		))
		diSizes.push(nextSize)

		const nextId = Arweave.utils.bufferTob64Url(header.subarray(
			base + 32,
			base + 64,
		))
		diIds.push(nextId)
	}

	//ensure buffer available for gc
	header = null as any

	return {
		status,
		numDataItems,
		diIds,
		diSizes,
	};
}
export const ans104HeaderData = memoize(ans104HeaderDataUnmemoized, { maxSize: 1000})
