import { slackLog } from '../../../../../libs/utils/slackLog'
import { arGql, ArGqlInterface } from 'ar-gql'
import { GQLEdgeInterface, GQLError } from 'ar-gql/dist/faces'
import moize from 'moize'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import pool, { batchUpsertTxsWithRules } from '../../../../../libs/utils/pgClient'
import { min_data_size } from '../../../../../libs/constants'
import { downloadWithChecks } from './downloadWithChecks'
import { chunkTxDataStream } from '../../../../../libs/chunkStreams/chunkTxDataStream'
import { gatewayStream } from '../../../../../libs/chunkStreams/gatewayStream'


const ARIO_DELAY_MS = 500

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


interface Inputs {
	metas: GQLEdgeInterface[]
	pageNumber: string
	gqlUrl: string
	gqlUrlBackup: string
	gqlProvider: string
	indexName: string
	streamSourceName: 'gateway' | 'nodes'
	downloadTimeout: number
}
/** ingest 1 page (batch) of new items to index. */
export const ingressHandler = async (inputs: Inputs) => {
	const { metas, pageNumber, gqlUrl, gqlUrlBackup, gqlProvider, indexName, streamSourceName, downloadTimeout } = inputs
	try {
		console.info(indexName, `processing page ${pageNumber} of ${metas.length} records`)

		/**
		 * filter records:-
		 * using metadata (in filterMetas, before the expensive buildRecords parent walk):
		 * - already in the database with the same/older height, or already flagged => discarded
		 * - size <= 4k => marked negligible-data and stored as-is (no download)
		 * while retrieving data (downloadWithChecks):
		 * - use network nodes to retrieve data (make this modular so we can switch to gateway streams also)
		 * - MIME sniffed by `file`/libmagic (256kb sample) starts with image/video/audio (sometimes detected as audio contains video)
		 *   - generic/unknown MIMEs (octet-stream, x-empty) are allowed through; other specific non-media types are rejected
		 *   - [handle html/pdf/docs later]
		 * - partial data allowed
		 * - actual data > 4kb again
		 * - 404 is 404 if nodes tried as well as gateway
		 * - abort dead connections (partial?)
		 * - connection and 4xx/5xx retrying <= do outside this function
		 */
		let numQueued = 0
		const updated: TxRecord[] = []
		const errored: { queued: boolean; record: TxRecord; errorId?: string }[] = []

		//discard already-stored/flagged metas and split off negligible records *before* building
		const { negligible, toBuild } = await filterMetas(metas, indexName, gqlProvider)
		updated.push(...negligible)

		//only build (incl. the parent-chain walk) the records we'll actually download
		const records = await buildRecords(
			toBuild,
			arGql({ endpointUrl: gqlUrl }),
			indexName,
			gqlProvider,
			arGql({ endpointUrl: gqlUrlBackup })
		)

		const streamSource = streamSourceName === 'gateway' ? gatewayStream : chunkTxDataStream
		console.debug(indexName, `starting downloadWithChecks for ${records.length}/${metas.length} records`)
		const queued = await downloadWithChecks(records, downloadTimeout, streamSource)
		console.debug(indexName, `downloadWithChecks completed for ${queued.length} records`)

		//sort processed records
		for (const entry of queued) {
			if (entry.queued === true) numQueued++
			else if (!entry.errorId) updated.push(entry.record)
			else errored.push(entry)
		}

		//upsert updated records
		console.debug(indexName, `starting database batch insert for ${updated.length} records`)
		const numInserted = await batchUpsertTxsWithRules(updated.map(r => ({
			//initial fields
			txid: r.txid,
			content_type: r.content_type,
			content_size: r.content_size,
			height: r.height,
			parent: r.parent || null,
			parents: r.parents || null,
			owner: r.owner,
			//added fields
			flagged: r.flagged,
			valid_data: r.valid_data || null, //should be deprecating this field
			data_reason: r.data_reason,
			last_update_date: r.last_update_date || new Date(),
		}) as TxRecord), 'txs') ?? 0

		console.info(indexName, `page ${pageNumber}, ${metas.length} metas (${records.length} built), ${numQueued} queued in S3, ${numInserted}/${updated.length} inserts, ${errored.length} errored.`)

		return {
			numQueued,
			numUpdated: updated.length,
			errored,
		}
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(indexName, 'ingressHandler', `Fatal error ❌ ${e.name}:${e.message}`, JSON.stringify(e))
		throw e
	}
}

const getParent = moize(
	async (p: string, gql: ArGqlInterface) => {
		const res = await gql.tx(p)
		return res.parent?.id || null
	},
	{
		isPromise: true,
		maxSize: 10_000, //allow for caching of maxSize number of bundles per query (1 block).
		maxArgs: 1,
		// onCacheHit: ()=>console.log(`getParent cache hit`),
		// onCacheAdd: async(cache, options)=> console.log(cache.keys, cache.values),
	},
)

/** exported for manual flagging tool */
/** map a raw GQL meta to the record fields we store, without the parent-chain
 * walk. Shared by buildRecords (for big records) and the negligible path. */
const metaToRecord = (item: GQLEdgeInterface) => ({
	txid: item.node.id,
	content_type: item.node.data.type || item.node.tags.find(t => t.name === 'Content-Type')!.value,
	content_size: item.node.data.size.toString(),
	height: item.node.block.height, // missing height should not happen and cause `TypeError : Cannot read properties of null (reading 'height')`
	parent: item.node.parent?.id || null, // the direct parent, if exists
	owner: item.node.owner.address.padEnd(43, ' '), //pad non-arweave addresses to 43 chars
})

export const buildRecords = async (metas: GQLEdgeInterface[], gql: ArGqlInterface, indexName: string, gqlProvider: string, gqlBackup: ArGqlInterface) => {

	const records: TxRecord[] = []

	for (const item of metas) {
		const { txid, content_type, content_size, height, parent: directParent, owner } = metaToRecord(item)
		let parent = directParent
		const parents: string[] = []

		// loop to find all nested parents
		if (parent) {
			let p: string | null = parent
			do {
				const t0 = performance.now()
				const p0: string = p

				try {
					p = await getParent(p0, gql)
				} catch (eOuter: unknown) {
					const outerMessage = (eOuter as GQLError).message
					await slackLog(`getParent error: "${outerMessage}" while fetching parent: "${p}" using: ${gqlProvider}, ${height}. Trying gqlBackup now.`)
					try {
						p = await getParent(p0, gqlBackup)
					} catch (eInner: unknown) {
						const gqlEInner = eInner as GQLError
						throw new TypeError(`getParent error: "${gqlEInner.message}" while fetching parent: ${p0} for dataItem: ${txid} USING GQLBACKUP: ${gqlBackup.endpointUrl.includes('goldsky') ? 'gold' : 'ario'}. ${gqlEInner.cause.gqlError}`)
					}
				}

				const t1 = performance.now() - t0

				/* if time less than 10ms, it's definitely a cache hit */
				if (t1 > 10) {
					let logstring = `got parent ${p0} details in ${t1.toFixed(0)}ms.`

					/* slow down, too hard to get out of arweave.net's rate-limit once it kicks in */
					if (gql.endpointUrl.includes('arweave.net')) {
						let timeout = ARIO_DELAY_MS - t1
						if (timeout < 0) timeout = 0
						logstring += ` pausing for ${timeout.toFixed(0)}ms.`
						await sleep(timeout)
					}
					console.info(indexName, txid, logstring, gqlProvider)
				}

			} while (p && parents.push(p))
		}

		records.push({
			txid,
			content_type,
			content_size,
			height,
			parent,
			...(parents.length > 0 && { parents }), //leave `parents` null if not nested
			owner,
		} as TxRecord)
	}

	return records;
}

/**
 * Filter raw GQL metas against the db *before* the expensive buildRecords
 * parent-chain walk:
 * - discard metas already stored unchanged (existing & not newer height, or flagged)
 * - negligible survivors (<= min_data_size) are marked and returned for writing as-is
 *   (no download, and buildRecords' parent walk is irrelevant for them)
 * - big survivors are returned as metas to build + download
 * Keys only on txid/height/size, all present in the raw meta.
 */
const filterMetas = async (metas: GQLEdgeInterface[], indexName: string, gqlProvider: string): Promise<{ negligible: TxRecord[]; toBuild: GQLEdgeInterface[] }> => {
	if (metas.length === 0) return { negligible: [], toBuild: [] }

	try {
		const existing = (await pool.query(`SELECT txid, height, flagged FROM txs WHERE txid IN (${metas.map(m => `'${m.node.id}'`).join(',')})`)).rows as Pick<TxRecord, 'txid' | 'height' | 'flagged'>[]
		const existingById = new Map(existing.map(e => [e.txid, e]))

		const negligible: TxRecord[] = []
		const toBuild: GQLEdgeInterface[] = []

		for (const m of metas) {
			const exist = existingById.get(m.node.id)
			// keep only genuinely new, or existing with newer height and not already flagged
			if (exist && !(exist.flagged !== true && m.node.block.height > exist.height)) continue

			if (m.node.data.size <= min_data_size) {
				negligible.push({
					...metaToRecord(m),
					parent: null, //negligible data is never fetched, so no parent chain is stored (matches prior behaviour)
					flagged: false,
					valid_data: false,
					data_reason: 'negligible-data',
					last_update_date: new Date(),
				} as TxRecord)
			} else {
				toBuild.push(m)
			}
		}

		return { negligible, toBuild }

	} catch (err: unknown) {
		const e = err as Error & { code?: string, detail: string }
		if (e.code && Number(e.code) === 23502) {
			slackLog('Error!', 'Null value in column violates not-null constraint', e.detail, gqlProvider, indexName)
			throw e
		} else {
			if (e.code) console.error('Error!', e.code, gqlProvider, indexName, e)
			throw e
		}
	}
}
