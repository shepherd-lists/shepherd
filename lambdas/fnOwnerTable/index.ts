import pg, { batchInsert } from './utils/pgClient'
import { slackLog } from './utils/slackLog'
import { arGql, ArGqlInterface, GQLUrls } from 'ar-gql'
import { OwnerTableRecord } from './types'
import moize from 'moize/mjs/index.mjs'
import { getByteRange } from './byte-ranges/byteRanges'



const gql = arGql(GQLUrls.goldsky)
const gqlBackup = arGql(GQLUrls.arweave)
const query = `
query($cursor: String, $owner: String!) {
  transactions(
    # your query parameters
    owners: [$owner]
    tags: [
      {name:"Bundle-Version", op:NEQ},
      {name: "type", values: "redstone-oracles", op: NEQ},
    ]
    
    # standard template below
    after: $cursor
    first: 100
  ) {
    pageInfo{hasNextPage}

    edges {
      cursor
      node {
        # what tx data you want to query for:
        id
        parent{id}
        data{size}
      }
    }
  }
}
`

const getParent = moize(
	async (p: string, gql: ArGqlInterface) => {
		const res = await gql.tx(p)
		return res.parent?.id || null
	},
	{
		isPromise: true,
		maxSize: 1_000	//should be enough
	},
)

export const handler = async (event: any) => {
	try {
		console.log('event', event)
		const inputs = event as { owner: string, tablename: string }
		if (!inputs.owner || !inputs.tablename) {
			throw new Error('missing inputs. should have { "owner": "string", "tablename": "string" }')
		}

		/** plan:
		 * receive tableName & owner
		 * gql all txids
		 * calculate ranges
		 * batch inserts to db, gql page at a time
		 */
		const variables = {
			owner: inputs.owner,
			// cursor: '',
		}
		const counts = { page: 0, items: 0, inserts: 0 }
		await gql.all(query, variables, async (page) => {
			console.info('processing page', ++counts.page)
			const records: OwnerTableRecord[] = []

			await Promise.all(page.map(async ({ node }) => {
				counts.items++

				/** skip small files */
				if (+node.data.size < 1_000) {
					console.log(`file too small, size: ${node.data.size}, txid: ${node.id}`)
					return;
				}

				/** build records */
				const txid = node.id
				const parent = node.parent?.id || null
				let parents: string[] | undefined = []

				// loop to find all nested parents
				if (parent) {
					let p: string | null = parent
					do {
						const p0: string = p

						try {
							p = await getParent(p0, gql)
						} catch (eOuter: unknown) {
							console.error(`getParent warning: "${(eOuter as Error).message}" while fetching parent: "${p}" for dataItem: ${txid} using gqlProvider: ${gql.endpointUrl}. Trying gqlBackup now.`)
							try {
								p = await getParent(p0, gqlBackup)
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
				counts.inserts++
				records.push({
					txid,
					parent,
					parents,
					byte_start: range.start.toString(),
					byte_end: range.end.toString(),
				})
			})) //eo promise.all(map)

			// /** batch insert this pages results */
			const inserted = await batchInsert(records, inputs.tablename)

		})

		console.info(`completed processing ${JSON.stringify(counts)}`)


		return event
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(`${e.name}:${e.message}`, JSON.stringify(e))
		throw e
	}
}
