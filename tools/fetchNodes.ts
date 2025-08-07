import 'dotenv/config'
import { getByteRange } from '../libs/byte-ranges/byteRanges'
import Arweave from 'arweave'
import { httpApiNodes, clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'

process.on('uncaughtException', (e, origin) => {
	clearTimerHttpApiNodes()
	throw e
})
process.on('exit', clearTimerHttpApiNodes)

/**
 * alter byteRanges to return offsets in the received chunk ranges.
 * aim is to get the data-item data, can only retrieve chunks from nodes,
 * so need encompassing chunks, as is already returned.
 * need small hack of byte-ranges lib to return data-item offsets within these chunks:
 * - dataStart and dataEnd ?
 * */


// /** dataItem */
// const dataItemId = 'SLfxp75GkPHEM1T_3lRdm4RYcmr8epVbKMVEFpGAvYs'
// const parentId = 'RnwNtQjkBwbgpJ9bm85A0pAerjavI0PyNOl59Ehd0SA'
// const diRange = await getByteRange(dataItemId, parentId, undefined)
// console.log(diRange)


/** reconstitute a base tx */
const getDataFromChunks = async (id: string, parent: string | null, parents?: string[]) => {
	//get the offset data
	const offsets = await getByteRange(id, parent, parents)
	console.log(offsets)

	//get the chunks
	const getChunks = async (dataStart: bigint, dataSize: bigint) => {

		//this is only goind to work for base txs
		const start = Number(dataStart), size = Number(dataSize)


		const httpNodes = [...httpApiNodes(), { url: 'https://arweave.net', name: 'arweave.net' }]
		const totalHttpNodes = httpNodes.length
		console.debug({ totalHttpNodes })


		let node = httpNodes.pop()
		const chunkStart = start + 1
		let byte = 0
		const data = new Uint8Array(size)

		while (byte < size) {
			let chunkJson: { chunk: string; packing: string; }
			try {
				const url = node!.url + `/chunk/${chunkStart + byte}`
				console.info(url)
				const res = await fetch(url)

				if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)

				chunkJson = await res.json() as { chunk: string; packing: string; }
				if (chunkJson.packing !== 'unpacked') throw new Error('chunk not unpacked', { cause: { packing: chunkJson.packing } })

				console.info(url, 'Success ✅')
			} catch (e) {
				if (e instanceof Error) {
					node = httpNodes.pop()
					if (!node) {
						console.error(String(e), 'Ran out of nodes to try. aborting!')
						return new Uint8Array(0)
					}
					console.error(String(e), `${httpNodes.length}/${totalHttpNodes} nodes left`)
					continue;
				}
				console.error('unhandled error', e)
				throw e
			}

			const chunk = Arweave.utils.b64UrlToBuffer(chunkJson!.chunk)
			console.debug(`chunk length ${chunk.length}, ${byte}/${size}`)
			data.set(chunk, byte)
			byte += chunk.length
		}
		return data;
	}

	const data = await getChunks(offsets.start, offsets.dataSize)

	if (parent) {
		console.error('data-items not impl yet!')
	}

	return data;

}

/** some base L1 tests */
console.info('-= base tx small =-')
const baseIdSmall = 'EwyiK6-mZj5d3pwts7zwreNBq-HyyzhECEnMISLE49I' //size 2.74kb, text/plain
const baseDataSmall = await getDataFromChunks(baseIdSmall, null, undefined)
console.debug('length', baseDataSmall.length)
// console.debug('decoded string:', new TextDecoder().decode(baseData))

/** large base tx */
console.info('-= base tx large =-')

const largeL1s = [
	'YvKsLs9zYc-qpPowicC2zfGSzZNiLcK3NB3J_qFVPGs', //size 520kb, original 2 years old

	/** !!! no new txs appear to be propagating !!! */
	'a168-YVIITXbvIj68uA_vt3MLTQWGEVe_fG9ROJ7FZE', //size 520kb, text
	'LZmLFAwjZ794w-K37wpbJkjM6RTeJiEpgokMbkdPXSY', //size 520kb, text ATTEMPT 2
	'I7lOcaJpUsEUPAerb0ao7Ws0Jmv1Aa9_-Xhq5GAfKdE', //size 520kb, text ATTEMPT 3
]

for (const baseIdLarge of largeL1s) {
	const baseDataLarge = await getDataFromChunks(baseIdLarge, null, undefined)
	console.debug('length', baseDataLarge.length)
}


//exit app
clearTimerHttpApiNodes()

