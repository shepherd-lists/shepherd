import pg from './utils/pgClient'
import { slackLog } from './utils/slackLog'
import { arGql, ArGqlInterface, GQLUrls } from 'ar-gql'
import { OwnerTableRecord } from './types'
import moize from 'moize/mjs/index.mjs'



const gql = arGql(GQLUrls.goldsky)
const gqlBackup = arGql(GQLUrls.arweave)
const query = `
query($cursor: String) {
  transactions(
    # your query parameters
    owners: "v2XXwq_FvVqH2KR4p_x8H-SQ7rDwZBbykSv-59__Avc"
    # standard template below
    after: $cursor
    first: 100
  ) {
    pageInfo {
      hasNextPage
    }
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
	console.log('event', event)

	/** plan:
	 * receive tableName & owner
	 * gql all txids
	 * calculate ranges
	 * batch inserts to db, gql page at a time
	 */
	const records: OwnerTableRecord[] = []

	await gql.all(query, {}, async (page) => {
		for (const { node } of page) {
			if (+node.data.size < 1_000) {
				console.log(`file too small ${node.data.size}`, JSON.stringify(node))
				continue;
			}
			const txid = node.id
			const parent = node.parent?.id || null
			let parents: string[] | null = []

			// loop to find all nested parents
			if (parent) {
				let p: string | null = parent
				do {
					const p0: string = p

					try {
						p = await getParent(p0, gql)
					} catch (eOuter: unknown) {
						console.error(`getParent error: "${(eOuter as Error).message}" while fetching parent: "${p}" for dataItem: ${txid} using gqlProvider: ${gql.endpointUrl}. Trying gqlBackup now.`)
						try {
							p = await getParent(p0, gqlBackup)
						} catch (eInner: unknown) {
							slackLog(`getParent error: "${(eInner as Error).message}" while fetching parent: ${p0} for dataItem: ${txid} Tried both gql endpoints.`)
						}
					}
				} while (p && parents.push(p))
			}
			parents = parents.length === 0 ? null : parents

			/** calculate byte-range */

			records.push({
				txid,
				parent,
				parents,
				byte_start,
				byte_end,
			})
		}
	})





	return event
}
