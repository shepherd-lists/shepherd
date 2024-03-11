import pg, { batchInsert, ownerToTablename } from './utils/pgClient'
import { slackLog } from './utils/slackLog'
import { arGql, ArGqlInterface, GQLUrls } from 'ar-gql'
import { OwnerTableRecord } from '../../types'
import { getByteRange } from './byte-ranges/byteRanges'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { gqlTx } from './byte-ranges/gqlTx'

const gql = arGql(process.env.GQL_URL_SECONDARY, 3) //defaults to goldsky
const gqlBackup = arGql(process.env.GQL_URL, 3) //defaults to arweave


/** the handler will receive 1 page of blocked wallet results. 
 * potentially for different wallets, but at scale only from 1 wallet.
 */
export const handler = async (event: any) => {
	try {
		console.info('event', JSON.stringify(event))
		const inputs = event as { page: GQLEdgeInterface[], pageNumber: number }
		if (!inputs.page || !Array.isArray(inputs.page) || inputs.page.length === 0) {
			throw new Error('missing inputs. should have { "page": "GQLEdgeInterface[non-zero]", "pageNumber": "number" }')
		}
		console.info(`processing page ${inputs.pageNumber}`)

		/** new plan:
		 * receive page of gql nodes for different blocked wallets
		 * build records for each node
		 * add them to separate record arrays for each wallet
		 * batch insert each wallet"s records
		 */

		const records: { [owner: string]: OwnerTableRecord[] } = {}

		await Promise.all(inputs.page.map(async ({ node }) => {

			/** skip small files */
			if (+node.data.size < 1_000) {
				console.log(`file too small, size: ${node.data.size}, txid: ${node.id}`)
				return;
			}

			/** build records */
			const txid = node.id
			const parent = node.parent?.id || null
			let parents: string[] | undefined = []
			const owner = node.owner.address

			// loop to find all nested parents
			if (parent) {
				let p: string | null = parent
				do {
					const p0: string = p

					try {
						p = (await gqlTx(p0, gql)).parent?.id || null
					} catch (eOuter: unknown) {
						console.error(`getParent warning: "${(eOuter as Error).message}" while fetching parent: "${p}" for dataItem: ${txid} using gqlProvider: ${gql.endpointUrl}. Trying gqlBackup now.`)
						try {
							p = (await gqlTx(p0, gqlBackup)).parent?.id || null
						} catch (eInner: unknown) {
							slackLog(`getParent error: "${(eInner as Error).message}" while fetching parent: ${p0} for dataItem: ${txid} Tried both gql endpoints.`)
						}
					}
				} while (p && parents.push(p))
			}
			parents = parents.length === 0 ? undefined : parents

			/** calculate byte-range */
			const range = await getByteRange(txid, parent, parents)

			if (range.start === -1n) {
				console.error(`Error in range calculation for txid: ${txid}`)
				return;
			}

			/** add to records */
			if (!records[owner]) records[owner] = []

			records[owner].push({
				txid,
				parent,
				parents,
				byte_start: range.start.toString(),
				byte_end: range.end.toString(),
			})
		})) //eo promise.all(map)

		/** batch insert this pages results */
		const counts: { [owner: string]: number; total: number } = { total: 0 }
		for (const key of Object.keys(records)) {
			const inserted = await batchInsert(records[key], ownerToTablename(key))

			if (!counts[key]) counts[key] = 0
			counts[key] += inserted!
			counts.total += inserted!
		}

		console.info(`completed processing page ${inputs.pageNumber} ${JSON.stringify(counts)}`)

		return counts
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(`Fatal error ❌ ${e.name}:${e.message}`, JSON.stringify(e))
		throw e
	}
}
