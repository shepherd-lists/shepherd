/**
 * Manage reported txids: insert into DB and sync S3 lists.
 *
 * Usage:
 *   npx tsx reported-txids.ts add <txid1> <txid2> ...   — insert txids & sync S3
 *   npx tsx reported-txids.ts update                     — sync S3 from current DB state
 *
 * Required env vars: DB_HOST, LISTS_BUCKET
 */
import 'dotenv/config'
import { arGql, GQLUrls } from 'ar-gql'
import pool from '../libs/utils/pgClient'
import { s3PutObject, s3ObjectTagging } from '../libs/utils/s3-services'

const [, , command, ...args] = process.argv

if (!command || !['add', 'update'].includes(command)) {
	console.error('Usage:')
	console.error('  npx tsx reported-txids.ts add <txid1> <txid2> ...')
	console.error('  npx tsx reported-txids.ts update')
	process.exit(1)
}
if (command === 'add' && !args.length) {
	console.error('Usage: npx tsx reported-txids.ts add <txid1> <txid2> ...')
	process.exit(1)
}

const LISTS_BUCKET = process.env.LISTS_BUCKET as string
if (!LISTS_BUCKET) throw new Error('LISTS_BUCKET is not set')

const BATCH_SIZE = 100

const sha1 = async (text: string) => {
	const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
	return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}
const s3GetTag = async (key: string, tagKey: string) => {
	try {
		const tagging = await s3ObjectTagging(LISTS_BUCKET, key)
		return tagging.TagSet?.find(t => t.Key === tagKey)?.Value
	} catch (e) {
		if (['NoSuchKey', 'NotFound'].includes((e as Error).name)) return undefined
		throw e
	}
}

/** write a text file to S3 only if the content has changed (SHA-1 tag check) */
const putIfChanged = async (key: string, text: string) => {
	const hash = await sha1(text)
	const existing = await s3GetTag(key, 'SHA-1')
	if (hash === existing) {
		console.info(`  ${key}: unchanged (hash ${hash.slice(0, 8)}…), skipping`)
		return false
	}
	await s3PutObject({ Bucket: LISTS_BUCKET, Key: key, text, Sha1: hash })
	console.info(`  ${key}: updated (hash ${hash.slice(0, 8)}…)`)
	return true
}

const add = async (txids: string[]) => {
	const gql = arGql({ endpointUrl: GQLUrls.goldsky, retries: 3 })
	console.info(`Adding ${txids.length} txids using ${gql.endpointUrl} ...`)

	for (let i = 0; i < txids.length; i += BATCH_SIZE) {
		const batch = txids.slice(i, i + BATCH_SIZE)

		const query = `
		query($ids: [ID!]) {
			transactions(ids: $ids, first: ${BATCH_SIZE}) {
				edges {
					node {
						id
						owner { address }
					}
				}
			}
		}`
		const res = await gql.run(query, { ids: batch })
		const edges: { node: { id: string; owner: { address: string } } }[] = res.data.transactions.edges

		const found = new Map(edges.map(e => [e.node.id, e.node.owner.address]))

		const missing = batch.filter(id => !found.has(id))
		if (missing.length) {
			console.warn(`Warning: ${missing.length} txids not found in GQL:`, missing)
		}

		if (!found.size) continue

		const rows = [...found.entries()]
		let idx = 0
		const values = rows.flat()
		const placeholders = rows.map(() => `($${++idx}, $${++idx})`).join(', ')

		const inserted = await pool.query(
			`INSERT INTO reported_txids (txid, owner) VALUES ${placeholders} ON CONFLICT DO NOTHING RETURNING *`,
			values,
		)

		console.info(`Upserted ${inserted.rowCount}/${rows.length} rows (batch size ${BATCH_SIZE}`)
	}
}

const syncLists = async () => {
	console.info('Syncing reported lists to S3...')

	const allTxids: string[] = (await pool.query('SELECT txid FROM reported_txids ORDER BY txid'))
		.rows.map((r: { txid: string }) => r.txid)
	const allOwners: string[] = (await pool.query('SELECT DISTINCT owner FROM reported_txids ORDER BY owner'))
		.rows.map((r: { owner: string }) => r.owner)

	await putIfChanged('reported/txids.txt', allTxids.join('\n') + '\n')
	await putIfChanged('reported/addresses.txt', allOwners.join('\n') + '\n')

	console.info(`reported_txids table: ${allTxids.length} txids, ${allOwners.length} distinct owners.`)
}

try {
	if (command === 'add') {
		await add(args)
	}
	//command === 'update' falls thru to here, they both need to sync db to the lists
	await syncLists()
	console.info('Done.')
} finally {
	await pool.end()
}
