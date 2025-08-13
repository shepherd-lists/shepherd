import { slackLog } from '../../libs/utils/slackLog'
import { arGql, ArGqlInterface } from 'ar-gql'
import { GQLEdgeInterface, GQLError } from 'ar-gql/dist/faces'
import moize from 'moize'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import pool, { batchInsert } from '../../libs/utils/pgClient'
import { min_data_size } from '../../libs/constants'


const ARIO_DELAY_MS = 500

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


interface Inputs {
	metas: GQLEdgeInterface[]
	pageNumber: number
	gqlUrl: string
	gqlUrlBackup: string
	gqlProvider: string
	indexName: string
}
/** the handler will receive 1 page of new items to index. */
export const handler = async (event: Inputs) => {
	try {
		console.info('event', JSON.stringify(event))

		/* check inputs */
		const { metas, pageNumber, gqlUrl, gqlUrlBackup, gqlProvider, indexName } = event
		if (
			!Array.isArray(metas) || metas.length === 0
			|| typeof pageNumber !== 'number' || pageNumber < 0
			|| typeof gqlUrl !== 'string' || !gqlUrl.match(/^https:\/\/[a-zA-Z0-9.-]+\/graphql/)
			|| typeof gqlUrlBackup !== 'string' || !gqlUrlBackup.match(/^https:\/\/[a-zA-Z0-9.-]+\/graphql/)
			|| typeof gqlProvider !== 'string'
			|| typeof indexName !== 'string'
		) {
			throw new Error('missing inputs. should have { metas: GQLEdgeInterface[], pageNumber: number, gqlUrl: string, gqlUrlBackup: string, gqlProvider: string, indexName: string, }')
		}

		const records = await buildRecords(
			metas,
			arGql({ endpointUrl: gqlUrl }),
			indexName,
			gqlProvider,
			arGql({ endpointUrl: gqlUrlBackup })
		)

		const inserts = await preFilterRecords(records, indexName, gqlProvider)

		return inserts;
	} catch (err: unknown) {
		const e = err as Error
		await slackLog('fnIndexer.handler', `Fatal error ❌ ${e.name}:${e.message}`, JSON.stringify(e))
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

const buildRecords = async (metas: GQLEdgeInterface[], gql: ArGqlInterface, indexName: string, gqlProvider: string, gqlBackup: ArGqlInterface) => {

	const records: TxRecord[] = []

	for (const item of metas) {
		const txid = item.node.id
		const content_type = item.node.data.type || item.node.tags.find(t => t.name === 'Content-Type')!.value
		const content_size = item.node.data.size.toString()
		const height = item.node.block.height // missing height should not happen and cause `TypeError : Cannot read properties of null (reading 'height')`
		let parent = item.node.parent?.id || null // the direct parent, if exists
		const parents: string[] = []
		const owner = item.node.owner.address.padEnd(43, ' ') //pad non-arweave addresses to 43 chars

		// loop to find all nested parents
		if (+content_size < min_data_size) { //dont waste resources on small records
			parent = null
		}
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

export const preFilterRecords = async (records: TxRecord[], indexName: string, gqlProvider: string) => {

	if (records.length === 0) return 0

	let upsertCount = 0

	/**
	 * filter records:-
	 * using metadata:
	 * - are already in the database and have the same height/parent/parents
	 * - already flagged
	 * - size > 4k. 
	 * while retrieving data:
	 * - use network nodes to retrieve data (make this modular so we can switch to gateway streams also)
	 * - fileType (16kb) is defined and starts with image/video/audio (sometimes detected as audio contains video) 
	 *   - [handle html/pdf/docs later]
	 *   - SVG files (special case: allows application/xml when database expects image/svg+xml)
	 * - partial data allowed
	 * - actual data > 4kb again
	 * - 404 is 404 if nodes tried as well as gateway
	 * - abort dead connections (partial?)
	 * - connection and 4xx/5xx retrying
	 */


	try {

		// const recordsInTxs = await knex<TxRecord>('txs').whereIn('txid', records.map(r => r.txid)) //no inbox anymore
		const existing = (await pool.query(`SELECT * FROM txs WHERE txid IN (${records.map(r => `'${r.txid}'`).join(',')})`)).rows as TxRecord[]


		/* step 1: update records with newer height */

		/* filter out records already flagged && with <= existing height */
		const eIds = existing.map(r => r.txid)
		const newRecords = records.filter(r => !eIds.includes(r.txid))
		const updateRecords = records.filter(r => existing.some(exist => (r.txid === exist.txid && exist.flagged !== true && r.height > exist.height)))
		const allRecords = [...newRecords, ...updateRecords]

		/** split records into 2 lists:
		 * - records with size < 4k
		 * - records with size >= 4k
		 */
		const [negligibleRecords, filteredRecords] = allRecords.reduce((acc, rec) => {
			if (+rec.content_size <= min_data_size) {
				rec.data_reason = 'negligible-data'
				rec.valid_data = false
				rec.flagged = false
				acc[0].push(rec)
			} else {
				acc[1].push(rec)
			}
			return acc;
		}, [[], []] as TxRecord[][])

		/** log negligibleRecords straight to db now */
		//should these actually be collected?
		const negligibleInserts = await batchInsert(negligibleRecords, 'txs')

		console.info(indexName, `inserted ${negligibleInserts}/${negligibleRecords.length} negligible records`)

		upsertCount += negligibleInserts ?? 0

		//output some count logs here already? 
		//...





		console.info(indexName, `inserted ${upsertCount}/${records.length} records`)

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

	return upsertCount;
}
