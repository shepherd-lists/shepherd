/*
 * Stream the full raw data of an L1 (top-level) Arweave transaction to a local file.
 * Uses /tx/{id}/offset plus /chunk2 on http_api nodes — suitable for large ANS-104 bundles.
 *
 * Env (same as other chunk tooling — see addons/services/.env):
 *   HOST_URL — gateway fallback for /tx/.../offset when chunk nodes fail
 *   http_api_nodes — JSON array of { name, server } OR http_api_nodes_url — JSON URL for that list
 *   ingress_nodes — optional JSON array of chunk gateways { url, name }
 *
 * Run from addons/services so dotenv picks up .env:
 *   cd addons/services && npx tsx tools/download-l1-txid.ts <txid> [outputPath]
 */
// import 'dotenv/config'
import '../tests/_import-test-env-vars'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { chunkTxDataStream } from '../libs/chunkStreams/chunkTxDataStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'

const argv = process.argv.slice(2)
const txid = argv[0]

if (!txid) {
	console.error('Usage: npx tsx tools/download-l1-txid.ts <txid> [outputPath]')
	process.exit(1)
}

const outputPath = argv[1] ?? `${process.cwd()}/${txid}.bin`

try {
	const abort = new AbortController()
	const { stream, byteRange } = await chunkTxDataStream(txid, null, undefined, abort.signal)
	if (byteRange.dataSize < 0n) {
		throw new Error(`No byte range for L1 txid ${txid} (missing or unknown on network)`)
	}
	console.info(`Expected payload size: ${byteRange.dataSize} bytes → ${outputPath}`)

	const nodeReadable = Readable.fromWeb(stream)
	const out = createWriteStream(outputPath)

	await pipeline(nodeReadable, out)
	console.info(`Wrote ${byteRange.dataSize} bytes to ${outputPath}`)
} finally {
	clearTimerHttpApiNodes()
}
