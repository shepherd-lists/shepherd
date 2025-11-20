// libs/chunk2-parser.ts

/**
 * Parser for Arweave /chunk2 binary response format
 * 
 * Format: [3:chunk_size][chunk][3:tx_path_size][tx_path][3:data_path_size][data_path][1:packing_size][packing]
 * All length prefixes are big-endian integers.
 */

interface Chunk2Response {
	chunk: Uint8Array
	txPath: Uint8Array
	dataPath: Uint8Array
	packing: Uint8Array
}

/**
 * Parse complete /chunk2 binary response.
 * WE DONT NEED THIS! REFERENCE ONLY
 */
function parseChunk2Response(data: Uint8Array): Chunk2Response {
	let offset = 0

	// Parse chunk (24-bit length big-endian prefix)
	const chunkSize = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]
	offset += 3
	const chunk = data.slice(offset, offset + chunkSize)
	offset += chunkSize

	// Parse tx_path (24-bit length big-endian prefix)
	const txPathSize = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]
	offset += 3
	const txPath = data.slice(offset, offset + txPathSize)
	offset += txPathSize

	// Parse data_path (24-bit length big-endian prefix)
	const dataPathSize = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]
	offset += 3
	const dataPath = data.slice(offset, offset + dataPathSize)
	offset += dataPathSize

	// Parse packing (8-bit length prefix)
	const packingSize = data[offset]
	offset += 1
	const packing = data.slice(offset, offset + packingSize)

	return {
		chunk,
		txPath,
		dataPath,
		packing,
	}
}

/**
 * Extract only the chunk data (fast path).
 * this is all we need along with header 'x-packing': 'unpacked'
 */
export function extractChunkOnly(data: Uint8Array): Uint8Array {
	const chunkSize = (data[0] << 16) | (data[1] << 8) | data[2] //24-bit big-endian prefix
	return data.slice(3, 3 + chunkSize)
}

/**
 * Extract chunk data with packing validation (only accepts unpacked chunks).
 * WE DONT NEED THIS! REFERENCE ONLY
 */
function extractUnpackedChunk(data: Uint8Array): Uint8Array {
	const result = parseChunk2Response(data)

	const packingStr = new TextDecoder().decode(result.packing)
	if (packingStr !== 'unpacked') {
		throw new Error(`Only unpacked chunks accepted, got: ${packingStr}`)
	}

	return result.chunk
}
