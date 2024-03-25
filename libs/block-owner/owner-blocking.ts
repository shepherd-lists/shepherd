import { createOwnerTable } from './owner-table-utils'
import { arGql } from 'ar-gql'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'


if (!process.env.FN_OWNER_BLOCKING) throw new Error('missing env var: FN_OWNER_BLOCKING')
if (!process.env.GQL_URL_SECONDARY) throw new Error('missing env var: GQL_URL_SECONDARY')
if (!process.env.GQL_URL) throw new Error('missing env var: GQL_URL')

const lambdaClient = new LambdaClient({})

const gql = arGql(process.env.GQL_URL_SECONDARY, 3) //defaults to goldsky
const gqlBackup = arGql(process.env.GQL_URL, 3) //defaults to arweave
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
	console.info(blockOwnerHistory.name, `created/exists table: ${tablename} for owner: ${owner}`)

	/** gql all txids for the wallet */
	const variables = {
		owners: [owner],
	}
	const counts = { page: 0, items: 0, inserts: 0 }
	await gql.all(query, variables, async (page) => {
		const pageNumber = ++counts.page
		console.info(blockOwnerHistory.name, 'processing page', pageNumber)

		const res = await lambdaClient.send(new InvokeCommand({
			FunctionName: process.env.FN_OWNER_BLOCKING as string,
			Payload: JSON.stringify({ page, pageNumber }),
			InvocationType: 'RequestResponse',
		}))
		if (res.FunctionError) {
			//slackLogs already happen in the lambda
			throw new Error(`Lambda error for ${owner}: ${res.FunctionError}`)
		}

		const lambdaCounts: { [owner: string]: number; total: number } = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))
		counts.items += page.length
		counts.inserts += lambdaCounts.total
	})

	console.info(blockOwnerHistory.name, `completed processing ${JSON.stringify(counts)} for owner: ${owner}`)

	return counts.inserts
}
