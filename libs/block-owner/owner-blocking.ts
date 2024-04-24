import { createOwnerTable } from './owner-table-utils'
import { arGql } from 'ar-gql'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import pool from '../utils/pgClient'
import { slackLog } from '../utils/slackLog'
import { readBlockOwnerQueue, updateBlockOwnerQueue } from '../utils/ssmParameters'
import { ownerTotalCount } from './owner-totalCount'
import { OwnersListRecord } from '../../types'


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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



/** add owner to queue */
export const queueBlockOwner = async (owner: string, method: 'auto' | 'manual') => {

	const q = await updateBlockOwnerQueue({ owner, method }, 'add') //returns [] if already in queue

	if (q.length === 0) {
		return 0 //already in queue (race conditions etc)
	}

	if (q.length === 1) {
		return blockOwnerHistory(owner, method)
	}

	await slackLog(queueBlockOwner.name, `${owner} added to queue`)

	return 0 //no items blocked at this time
}

export const processBlockedOwnersQueue = async () => {
	const q = await readBlockOwnerQueue()

	/** short-circuits */

	if (q.length === 0) return

	/** attempt one owner per cycle, it's already too fast */
	//TODO: can we do this all in the param store rather than polling the db?
	const running = await pool.query<OwnersListRecord>(`SELECT * FROM owners_list WHERE add_method = 'updating'`)
	if (running.rows.length > 0) {
		console.info(processBlockedOwnersQueue.name, running.rows[0].owner, 'blocking already in progress')
		return
	}

	/** get the first owner */
	const item = q.shift()!

	console.info(processBlockedOwnersQueue.name, 'processing', item.owner)

	/** actually update. n.b. mark 'updating' and remove from queue are handled internally */
	const inserts = await blockOwnerHistory(item.owner, item.method)

	return inserts;
}

const blockOwnerHistory = async (owner: string, method: 'auto' | 'manual') => {
	/** steps:
	 * 1. infractions table should already exist
	 * 2. create owner table
	 * 3. gql all txids
	 * 4. send pages to lambdas (getParents, calc ranges, build records, insert to owner table)
	 */

	const totalItems = await ownerTotalCount(owner)

	/** check owner blocking not currently in progess or done */
	//TODO: use the param store for state instead of the db
	if (method === 'auto') {
		const status = await pool.query(`
			UPDATE owners_list
			SET add_method = 'updating' 
			WHERE owner = $1 AND add_method = 'auto' 
			RETURNING *`,
			[owner]
		)

		await slackLog(blockOwnerHistory.name, `DEBUG ${owner} status count: ${status.rowCount}, rows:`, JSON.stringify(status.rows))

		if (status.rowCount === 0) {
			await slackLog(blockOwnerHistory.name, `owner ${owner} is already being blocked`)
			return 0
		}

		/** don't automatically block giant wallets! */
		if (totalItems > 100_000) {
			await slackLog(blockOwnerHistory.name, `🚫:warning: ${owner} has ${totalItems.toLocaleString()} items. NOT BLOCKING :warning:🚫`)
			/** update owner_list status, 
			 * so that owners are not added to addresses.txt and blockIngest doesn't break */
			await pool.query(`UPDATE owners_list SET add_method = $1 WHERE owner = $2`, [totalItems.toLocaleString(), owner])

			/** remove from queue */
			await updateBlockOwnerQueue({ owner, method }, 'remove')

			return 0
		}
	} else { //method === 'manual'
		await pool.query(`UPDATE owners_list SET add_method = 'updating', last_update = now() WHERE owner = $1`, [owner])
	}
	slackLog(blockOwnerHistory.name, `:warning: ${owner} will be blocked, with ${totalItems.toLocaleString()} potential items`)

	/** create owner table */
	const tablename = await createOwnerTable(owner)
	console.info(blockOwnerHistory.name, `created/exists table: ${tablename} for owner: ${owner}`)

	/** gql paginate thru all wallet txids */
	let hasNextPage = true
	let cursor = ''
	const variables = {
		owners: [owner.trim()],
	}
	const counts = { page: 0, items: 0, inserts: 0 }

	while (hasNextPage) {
		let nextPage = { hasNextPage: false }
		let page: GQLEdgeInterface[] = []
		try {
			const { edges, pageInfo } = (await gql.run(
				query,
				{ ...variables, cursor }
			)).data.transactions
			page = edges
			nextPage = pageInfo


			if (page && page.length) {
				cursor = page[page.length - 1]!.cursor

				const res = await lambdaClient.send(new InvokeCommand({
					FunctionName: process.env.FN_OWNER_BLOCKING as string,
					Payload: JSON.stringify({ page, pageNumber: counts.page }),
					InvocationType: 'RequestResponse',
				}))
				if (res.FunctionError) {
					let payloadMsg = ''
					try { payloadMsg = new TextDecoder().decode(res.Payload) }
					catch (e) { payloadMsg = 'error decoding Payload with res.FunctionError' }
					throw new Error(`Lambda error for ${owner}: ${res.FunctionError}, payload: ${payloadMsg}`, { cause: res })
				}

				const lambdaCounts: { [owner: string]: number; total: number } = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))
				counts.inserts += lambdaCounts.total
			}
		} catch (err: unknown) {
			console.debug(blockOwnerHistory.name, err)
			const e = err as Error
			if (typeof e.cause === 'number' && e.cause >= 500)
				await slackLog(blockOwnerHistory.name, `GQL ERROR ${e.name}:${e.message} (http ${e.cause}) retrying after 10 seconds`, e)
			else
				await slackLog(blockOwnerHistory.name, `LAMBDA ERROR (MAYBE) ${e.name}:${e.message} (http? ${e.cause}) retrying after 10 seconds`, JSON.stringify(e))
			await sleep(10_000)
			continue;
		}

		/** put counters at end to avoid double counts on errors */
		console.info(blockOwnerHistory.name, owner, 'processed page', counts.page++)
		hasNextPage = nextPage.hasNextPage
		counts.items += page.length
	}//EO paging-loop


	/** update owner_list status, if no error thrown above */
	const check = await pool.query(`
		UPDATE owners_list 
		SET add_method = 'blocked' 
		WHERE owner = $1 RETURNING *`,
		[owner]
	)
	console.debug(`owner ${owner} add_method finialized`, check.rowCount === 1, check.rows[0]?.add_method)

	/** remove from queue */
	await updateBlockOwnerQueue({ owner, method }, 'remove')


	await slackLog(blockOwnerHistory.name, `✅ ${owner} blocking completed ${JSON.stringify(counts)}`)


	return counts.inserts
}

