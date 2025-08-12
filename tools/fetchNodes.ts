import 'dotenv/config'
import { getByteRange } from '../libs/byte-ranges/byteRanges'
import Arweave from 'arweave'
import { httpApiNodes, clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { writeFileSync } from 'node:fs'

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
	const getChunks = async (rangeStart: bigint, dataStart: bigint, dataSize: bigint) => {

		const start = Number(rangeStart), end = Number(dataStart + dataSize)


		const httpNodes = [
			...httpApiNodes(),
			{ url: 'https://arweave.net', name: 'arweave.net' },
			{ url: 'http://tip-2.arweave.xyz:1984', name: 'tip-2.arweave.xyz' },
			{ url: 'http://tip-3.arweave.xyz:1984', name: 'tip-3.arweave.xyz' },
			{ url: 'http://tip-4.arweave.xyz:1984', name: 'tip-4.arweave.xyz' },
		]
		const totalHttpNodes = httpNodes.length
		console.debug({ totalHttpNodes })


		let node = httpNodes.pop()
		const chunkStart = start + 1
		let byte = 0
		const data = new Uint8Array(end + 262_144) //extra 256kb to allow for rest of chunk

		while (byte < end) {
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
			console.debug(`chunk length ${chunk.length}, ${byte}/${end}`)
			data.set(chunk, byte)
			byte += chunk.length
		}
		return data;
	}

	const chunks = await getChunks(offsets.start, offsets.dataStart, offsets.dataSize)

	console.debug('data', chunks.length)
	console.debug('dataStart', offsets.dataStart)
	console.debug('dataEnd', offsets.dataStart + offsets.dataSize)
	let data = chunks.slice(Number(offsets.dataStart), Number(offsets.dataStart + offsets.dataSize))


	if (parent) {
		//need to remove di header
		const dataItem = data

		const dataItemDataOffset = (dataItem: Uint8Array) => {
			let offset = 0

			// Signature type (2 bytes)
			const sigType = new DataView(dataItem.buffer).getUint16(offset, true)
			offset += 2

			// Signature length depends on type: 512 most common (RSA/EdDSA); 65 secp256k1
			const sigLength = sigType === 3 ? 65 : 512
			offset += sigLength

			// Owner (512 bytes)
			offset += 512

			// Target presence byte + target
			const targetPresent = dataItem[offset] === 1
			offset += 1
			if (targetPresent) offset += 32

			// Anchor presence byte + anchor  
			const anchorPresent = dataItem[offset] === 1
			offset += 1
			if (anchorPresent) offset += 32

			// Number of tags (8 bytes)
			// const numTags = new DataView(dataItem.buffer).getBigUint64(offset, true)
			offset += 8

			// Tags bytes length (8 bytes)
			const tagsLength = new DataView(dataItem.buffer).getBigUint64(offset, true)
			offset += 8

			// Skip tags data
			offset += Number(tagsLength)

			// Remaining is content
			return offset;
		}

		data = dataItem.slice(dataItemDataOffset(dataItem))
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
	// 'YvKsLs9zYc-qpPowicC2zfGSzZNiLcK3NB3J_qFVPGs', //size 520kb, original 2 years old

	// // /** !!! no new txs appear to be propagating !!! */
	// 'a168-YVIITXbvIj68uA_vt3MLTQWGEVe_fG9ROJ7FZE', //size 520kb, text ATTEMPT 1 working after adding tip nodes!
	// 'LZmLFAwjZ794w-K37wpbJkjM6RTeJiEpgokMbkdPXSY', //size 520kb, text ATTEMPT 2 working after adding tip nodes!
	// 'I7lOcaJpUsEUPAerb0ao7Ws0Jmv1Aa9_-Xhq5GAfKdE', //size 520kb, text ATTEMPT 3 working after adding tip nodes!
	'YqIGNFqScA5bIGLpt083Zp7fHcz7ApL-Do1e1bhMM3Q', //size 520kb, text ATTEMPT 4 
]

for (const baseIdLarge of largeL1s) {
	const baseDataLarge = await getDataFromChunks(baseIdLarge, null, undefined)
	console.debug('length', baseDataLarge.length)
}


/** data-items */
console.info('-= small data-item =-')
const diId = 'tPYLhLIxxq-pQJ95FWLVzaYG2VOiXyDsZwZLL6uOCvw'
const diParent = '9KtQZqJAQwA7lYxKnjo6oN8YqQLWfusZ0DJNxRPDMac'
const diData = await getDataFromChunks(diId, diParent, undefined)
console.debug('length', diData.length, `content: "${new TextDecoder().decode(diData)}"`)

console.info('-= large data-item =-')
const diId2 = 'hYvWBh8atbm8WzwLdp8qTHGncGYFcnPdSfUPfF0jj0I'
const diParent2 = 'BPdVS50l0LdiM2w8mYYXX_v31UM9MOMx0zpXSUiA69A'
const diData2 = await getDataFromChunks(diId2, diParent2, undefined)
console.debug('length', diData2.length)
writeFileSync(`${diId2}.txt`, diData2)


//exit app
clearTimerHttpApiNodes()

