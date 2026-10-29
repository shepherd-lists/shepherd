/*
 * Stream the raw payload bytes of an ANS-104 data-item to a local file.
 *
 * Unlike download-l1-txid.ts (which handles top-level L1 txs), this streams through
 * chunkTxDataStream — which skips weave padding and strips the ANS-104 data-item
 * header, so the output is the raw payload bytes (identical to what the classifier sees).
 *
 * Env (same as download-l1-txid.ts — see addons/services/.env):
 *   HOST_URL — HyperBEAM node for the data-item's offset, and gateway fallback for /tx/.../offset
 *   http_api_nodes — JSON array of { name, server } OR http_api_nodes_url — JSON URL for that list
 *   ingress_nodes — optional JSON array of chunk gateways { url, name }
 *
 */
import '../tests/_import-test-env-vars'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { chunkTxDataStream } from '../libs/chunkStreams/chunkTxDataStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'

const argv = process.argv.slice(2)
const txid = argv[0]

if (!txid) {
	console.error('Usage: npx tsx tools/download-data-item-txid.ts <txid>')
	process.exit(1)
}

const outputPath = `${process.cwd()}/${txid}.bin`

try {
	const abort = new AbortController()
	const { stream, byteRange } = await chunkTxDataStream(txid, null, undefined, abort.signal)
	if (!byteRange.headerLength) {
		abort.abort()
		console.error(`${txid} is not a data-item (L1 tx) — use download-l1-txid.ts instead`)
		process.exit(1)
	}
	if (byteRange.dataSize < 0n) {
		throw new Error(`No byte range for data-item ${txid} (missing or unknown on network)`)
	}
	console.info(`Expected payload size: ${byteRange.dataSize} bytes → ${outputPath}`)

	const nodeReadable = Readable.fromWeb(stream)
	const out = createWriteStream(outputPath)

	await pipeline(nodeReadable, out)
	console.info(`Wrote ${byteRange.dataSize} bytes to ${outputPath}`)
} finally {
	clearTimerHttpApiNodes()
}
