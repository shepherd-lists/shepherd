import { arGql, GQLUrls } from 'ar-gql'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import pool from 'libs/utils/pgClient'
import { s3GetObject, s3HeadObject } from 'libs/utils/s3-services'
import { performance } from 'perf_hooks'

if (!process.env.LISTS_BUCKET) throw new Error('missing env var, LISTS_BUCKET')
const LISTS_BUCKET = process.env.LISTS_BUCKET!

const lambdaClient = new LambdaClient({})
const gql = arGql(GQLUrls.goldsky, 3)

const ingestQuery = `
query($cursor: String, $owners: [String!], $minAt: Int, $maxAt: Int) {
  transactions(
    # your query parameters
		owners: $owners

		ingested_at: {
      min: $minAt,
      max: $maxAt,
    }

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


const getOwnerBlockingPosition = async () => (await pool.query(`SELECT value FROM states WHERE pname = 'owner_ingest'`)).rows[0].value

const getETag = async () => (await s3HeadObject(process.env.LISTS_BUCKET!, 'addresses.txt')).ETag!

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const blockOwnerIngest = async (loop: boolean = true) => {
	const lastMax = await getOwnerBlockingPosition()
	console.debug('owner_ingest position', lastMax)

	let addresses = {
		owners: [] as string[],
		eTag: '',
	}

	const latestAddreses = async () => {
		const eTag = await getETag()
		if (addresses.eTag !== eTag) {
			const owners = (await s3GetObject(LISTS_BUCKET, 'addresses.txt')).split('\n')
			owners.pop() // remove last empty line
			addresses = {
				owners,
				eTag,
			}
			console.info('addresses updated', addresses)
		}
		return addresses
	}

	const interval = 30 // seconds
	const sleepMs = 1_000

	const maxAt = lastMax + interval
	const minAt = lastMax + 1

	let vars = {
		owners: [] as string[],
		minAt,
		maxAt,
	}
	do {

		/** update vars before next run */
		const { owners } = await latestAddreses()
		let minAt = vars.maxAt + 1
		let maxAt = minAt + interval
		vars = {
			owners,
			minAt,
			maxAt,
		}

		/** init stat outputs */
		const counts = { page: 0, items: 0, inserts: 0 }
		const ingestedOwners: { [owner: string]: number } = {}

		/** wait until next interval to run */

		const t0 = performance.now()
		while (Date.now() < maxAt * 1000) {
			await sleep(sleepMs)
		}
		const t1 = performance.now()
		console.info(blockOwnerIngest.name, `begin query after waiting ${(t1 - t0).toFixed(0)}ms`)

		await gql.all(ingestQuery, vars, async (page) => {
			const pageNumber = ++counts.page
			console.info(blockOwnerIngest.name, 'processing page', pageNumber)

			/** fire off the generic lambdas */
			const res = await lambdaClient.send(new InvokeCommand({
				FunctionName: process.env.FN_OWNER_BLOCKING as string,
				Payload: JSON.stringify({ page, pageNumber }),
				InvocationType: 'RequestResponse',
			}))

			/** update stats */
			const lambdaCounts: { [owner: string]: number; total: number } = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))
			for (const owner in lambdaCounts) {
				if (owner === 'total') continue
				ingestedOwners[owner] = (ingestedOwners[owner] || 0) + lambdaCounts[owner]
			}

			counts.items += page.length
			counts.inserts += lambdaCounts.total
		})// end gql.all

		/** output stats for this run */
		console.info(
			blockOwnerIngest.name, `completed processing ${JSON.stringify({ minAt, maxAt, counts })}`,
			JSON.stringify({ ingestedOwners }),
		)

		/** update state */
		await pool.query(`UPDATE states SET value = $1 WHERE pname = 'owner_ingest'`, [vars.maxAt])


	} while (loop)
}
