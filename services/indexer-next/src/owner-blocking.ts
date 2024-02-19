import { createOwnerTable } from './utils/owner-table-utils'
import { arGql, GQLUrls } from 'ar-gql'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'



const lambdaClient = new LambdaClient({})

const gql = arGql(GQLUrls.goldsky, 3)
const gqlBackup = arGql(GQLUrls.arweave, 3)
const query = `
query($cursor: String, $owners: [String!]) {
  transactions(
    # your query parameters
    owners: $owners
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
				owner{address}
      }
    }
  }
}
`


export const blockOwnerHistory = async (owner: string) => {
	/** steps:
	 * 1. infractions table should already exist
	 * 2. create owner table
	 * 3. gql all txids
	 * 4. send pages to lambdas (getParents, calc ranges, build records, insert to owner table)
	 */

	/** create owner table */
	const tablename = await createOwnerTable(owner)

	/** gql all txids for the wallet */
	const variables = {
		owners: [owner],
	}
	const counts = { page: 0, items: 0, inserts: 0 }
	await gql.all(query, variables, async (page) => {
		const pageNumber = ++counts.page
		console.info(blockOwnerHistory.name, 'processing page', pageNumber)

		const res = await lambdaClient.send(new InvokeCommand({
			FunctionName: process.env.FN_OWNER_TABLE as string,
			Payload: JSON.stringify({ page, pageNumber }),
			InvocationType: 'RequestResponse',
		}))
		//TODO: handle errors in lambda

		const lambdaCounts: { [owner: string]: number; total: number } = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))
		counts.items += page.length
		counts.inserts += lambdaCounts.total
	})

	console.info(blockOwnerHistory.name, `completed processing ${JSON.stringify(counts)} for owner: ${owner}`)

}
