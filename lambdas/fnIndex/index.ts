import { slackLog } from '../../libs/utils/slackLog'
import { arGql, ArGqlInterface } from 'ar-gql'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import moize from 'moize'
import { TxRecord, TxScanned } from 'shepherd-plugin-interfaces/types'
import knexCreate from '../../libs/utils/knexCreate'


const ARIO_DELAY_MS = 500

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const knex = knexCreate()

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

		const inserts = await buildRecords(
			metas,
			arGql({ endpointUrl: gqlUrl }),
			indexName,
			gqlProvider,
			arGql({ endpointUrl: gqlUrlBackup })
		)

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
	const records: TxScanned[] = []

	for (const item of metas) {
		const txid = item.node.id
		const content_type = item.node.data.type || item.node.tags.find(t => t.name === 'Content-Type')!.value
		const content_size = item.node.data.size.toString()
		const height = item.node.block.height // missing height should not happen and cause `TypeError : Cannot read properties of null (reading 'height')`
		const parent = item.node.parent?.id || null // the direct parent, if exists
		const parents: string[] = []
		const owner = item.node.owner.address.padEnd(43, ' ') //pad non-arweave addresses to 43 chars

		// loop to find all nested parents
		if (parent) {
			let p: string | null = parent
			do {
				const t0 = performance.now()
				const p0: string = p

				try {
					p = await getParent(p0, gql)
				} catch (eOuter: unknown) {
					const outerMessage = (eOuter as Error).message
					await slackLog(`getParent error: "${outerMessage}" while fetching parent: "${p}" using: ${gqlProvider}, ${height}. Trying gqlBackup now.`)
					try {
						p = await getParent(p0, gqlBackup)
					} catch (eInner: unknown) {
						throw new TypeError(`getParent error: "${(eInner as Error).message}" while fetching parent: ${p0} for dataItem: ${txid} USING GQLBACKUP: ${gqlBackup.endpointUrl.includes('goldsky') ? 'gold' : 'ario'}`)
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
		})
	}

	return insertRecords(records, indexName, gqlProvider)
}

/** export insertRecords for test only */
export const insertRecords = async (records: TxScanned[], indexName: string, gqlProvider: string) => {

	if (records.length === 0) return 0

	let alteredCount = 0
	try {
		if (indexName === 'indexer_tip') {
			/** expecting almost zero conflicts here */

			// console.log('pass1 inserting records', records.length, {records})

			await knex<TxRecord>('inbox').insert(records).onConflict('txid').merge(['height', 'parent', 'parents', 'byteStart', 'byteEnd'])
			alteredCount = records.length
		} else {
			/** generally speaking, it's the norm to not see updates on pass2.
			 * we would be expecting mostly conflicts here, so we will only update
			 * records with newer height, and insert missing records
			 */

			const recordsInInbox = await knex<TxRecord>('inbox').whereIn('txid', records.map(r => r.txid))
			const recordsInTxs = await knex<TxRecord>('txs').whereIn('txid', records.map(r => r.txid))
			const recordsInDb = [...recordsInInbox, ...recordsInTxs]


			/* step 1: update records with newer height */

			/* filter out records with same or less height */
			const updateRecords = records.filter(r => recordsInDb.some(exist => (r.txid === exist.txid && r.height > exist.height)))

			const updatedIds = await Promise.all(updateRecords.map(async r =>
				(
					await knex<TxRecord>('inbox')
						.update({
							height: r.height,
							parent: r.parent,
							parents: r.parents,
							byteStart: undefined,
							byteEnd: undefined,
						})
						.where('txid', r.txid)
						.returning('txid')
				)[0]
			))

			alteredCount += updatedIds.length

			if (updatedIds.length > 0) console.log(`updated ${updatedIds.length}/${updateRecords.length} records.`, 'updatedIds', JSON.stringify(updatedIds))

			/* step 2: insert missing records */

			const missingRecords = records.filter(r => !recordsInDb.map(r => r.txid).includes(r.txid))
			alteredCount += missingRecords.length

			console.log(`missingRecords: length ${missingRecords.length}`)

			if (missingRecords.length > 0) {
				const res = await knex<TxRecord>('inbox')
					.insert(missingRecords)
					.onConflict().ignore() //can occur in restart during half finished height
					.returning('txid')
				console.log(`inserted ${res.length}/${missingRecords.length} missingRecords`, JSON.stringify(missingRecords))
			}

			console.info(indexName, `inserted ${alteredCount}/${records.length} records`)
		}

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

	return alteredCount
}
