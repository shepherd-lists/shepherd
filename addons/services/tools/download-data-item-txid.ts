/*
 * Stream the raw payload bytes of an ANS-104 data-item to a local file.
 *
 * Unlike download-l1-txid.ts (which handles top-level L1 txs), this resolves the
 * data-item's parent chain via GraphQL, then streams through chunkTxDataStream —
 * which skips weave padding and strips the ANS-104 data-item header, so the output
 * is the raw payload bytes (identical to what the classifier sees).
 *
 * Env (same as download-l1-txid.ts — see addons/services/.env):
 *   HOST_URL — gateway fallback for /tx/.../offset when chunk nodes fail
 *   http_api_nodes — JSON array of { name, server } OR http_api_nodes_url — JSON URL for that list
 *   ingress_nodes — optional JSON array of chunk gateways { url, name }
 *   GQL_URL / GQL_URL_SECONDARY — Arweave GraphQL endpoints (primary + fallback) for parent-chain walk
 *
 * Run from addons/services so dotenv picks up .env:
 *   cd addons/services && npx tsx tools/download-data-item-txid.ts <txid>
 */
// import 'dotenv/config'
import '../tests/_import-test-env-vars'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { arGql } from 'ar-gql'
import type { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { chunkTxDataStream } from '../libs/chunkStreams/chunkTxDataStream'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { buildRecords } from '../services/indexer-next/src/index-shared/ingress/index'

const argv = process.argv.slice(2)
const txid = argv[0]

if (!txid) {
	console.error('Usage: npx tsx tools/download-data-item-txid.ts <txid>')
	process.exit(1)
}

const outputPath = `${process.cwd()}/${txid}.bin`

try {
	// Resolve the parent chain. Secondary (goldsky) as primary, GQL_URL as backup —
	// same ordering used by manually-flag-txid.ts / the ingress path.
	const gql = arGql({ endpointUrl: process.env.GQL_URL_SECONDARY!, retries: 3 })
	const gqlBackup = arGql({ endpointUrl: process.env.GQL_URL!, retries: 3 })

	console.info(`Fetching tx metadata + parent chain for ${txid} ...`)
	const node = await gql.tx(txid)
	const meta: GQLEdgeInterface = { cursor: '', node }
	const [record] = await buildRecords([meta], gql, 'download-data-item', 'download-data-item-txid.ts', gqlBackup)
	if (!record) throw new Error(`buildRecords returned no record for ${txid}`)

	if (!record.parent) {
		console.error(`${txid} is not a data-item (L1 tx) — use download-l1-txid.ts instead`)
		process.exit(1)
	}

	console.info(`Resolved parent: ${record.parent}`)
	console.info(`Resolved parents (ancestry): ${JSON.stringify(record.parents ?? [])}`)

	const abort = new AbortController()
	const { stream, byteRange } = await chunkTxDataStream(txid, record.parent, record.parents, abort.signal)
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
