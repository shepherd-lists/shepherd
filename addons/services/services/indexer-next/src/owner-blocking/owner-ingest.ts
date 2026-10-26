import { arGql } from 'ar-gql'
import { blockOwnerPage } from '../../../../libFunctions/fnOwnerBlocking/index'
import pool from '../../../../libs/utils/pgClient'
import { s3GetObject, s3HeadObject } from '../../../../libs/utils/s3-services'
import { slackLog } from '../../../../libs/utils/slackLog'
import { updateTxtLists } from '../../../../libFunctions/updateTxtLists/index'
import { GQLError } from 'ar-gql/dist/faces'
import { gqlHeight as gqlHeightOrig } from '../index-by-height/gql-height'


if (!process.env.LISTS_BUCKET) throw new Error('missing env var, LISTS_BUCKET')
const LISTS_BUCKET = process.env.LISTS_BUCKET!
if (!process.env.GQL_URL) throw new Error('missing env var: GQL_URL')
const GQL_URL = process.env.GQL_URL
const gql = arGql({ endpointUrl: GQL_URL, retries: 3 }) //defaults to arweave, addresses.txt holds native forms for its `owners:`

/** blocks behind the tip, so late-indexed bundle items are in by the time a block is queried */
const LAG = 20
/** extra blocks behind LAG when seeding the position, to cover the cutover */
const LOOKBACK = 30

/** `block` not `ingested_at`: HyperBEAM gateways ignore `ingested_at` and return everything */
const ingestQuery = `
query($cursor: String, $owners: [String!], $min: Int, $max: Int) {
	transactions(
		# your query parameters
		owners: $owners

		block: {
			min: $min,
			max: $max,
		}

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
				tags{name value}
			}
		}
	}
}
`


/** the last block height processed. 0 means seed from the tip */
const getOwnerBlockingPosition = async (): Promise<number> => (await pool.query(`SELECT value FROM states WHERE pname = 'owner_ingest'`)).rows[0].value

const setOwnerBlockingPosition = async (height: number) => pool.query(`UPDATE states SET value = $1 WHERE pname = 'owner_ingest'`, [height])

const getETag = async () => (await s3HeadObject(process.env.LISTS_BUCKET!, 'addresses.txt')).ETag!

const sleepOrig = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

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
		console.info(blockOwnerIngest.name, 'addresses cache updated', JSON.stringify(addresses))
	}
	return addresses
}

/** survives a failed range, so its inserts are still announced on the retry */
let unannounced = { inserts: 0, owners: {} as { [owner: string]: number } }

/** ingest the blocked owners' items in blocks `min` to `max` */
const ingestRangeOrig = async (min: number, max: number) => {

	/** init stat outputs */
	const counts = { page: 0, items: 0, inserts: 0 }
	const ingestedOwners: { [owner: string]: number } = {}

	/** get the very latest owners */
	const { owners } = await latestAddreses()

	/** `owners: []` would match every owner */
	if (owners.length === 0) return console.info(blockOwnerIngest.name, `no blocked owners, skipping blocks ${min}-${max}`)

	const vars = {
		owners: owners.map(o => o.trim()), // some addresses have trailing spaces, e.g. eth signers
		min,
		max,
	}

	await gql.all(ingestQuery, vars, async (page) => {
		const pageNumber = ++counts.page
		console.info(blockOwnerIngest.name, 'processing page', pageNumber)

		const pageCounts: { [owner: string]: number; total: number } = await blockOwnerPage(page, pageNumber)
		for (const owner in pageCounts) {
			if (owner === 'total') continue
			ingestedOwners[owner] = (ingestedOwners[owner] || 0) + pageCounts[owner]
			unannounced.owners[owner] = (unannounced.owners[owner] || 0) + pageCounts[owner]
		}

		counts.items += page.length
		counts.inserts += pageCounts.total
		unannounced.inserts += pageCounts.total
	})// end gql.all

	/** output stats for this run */
	console.info(
		blockOwnerIngest.name, `completed processing ${JSON.stringify({ min, max, counts })}`,
		JSON.stringify({ ingestedOwners }),
	)

	/** update txt lists */
	try {
		if (unannounced.inserts > 0) {
			const { inserts, owners: insertedOwners } = unannounced
			unannounced = { inserts: 0, owners: {} }
			await updateTxtLists()
			slackLog(blockOwnerIngest.name, `added ${inserts} items from owners:`, JSON.stringify(insertedOwners))
		}
	} catch (e) {
		await slackLog(blockOwnerIngest.name, `ERROR in owner-ingest.ts updateTxtLists failed. :warning::warning: NOT RETRYING! :warning::warning: may need to run updateTxtLists manually.`, e)
	}
}

export const blockOwnerIngest = async (
	/* dependency injection for test */
	{
		loop = true,
		sleep = sleepOrig,
		gqlHeight = gqlHeightOrig,
		ingestRange = ingestRangeOrig,
	} = {},
) => {
	let position = await getOwnerBlockingPosition()
	if (position === 0) {
		position = (await gqlHeight(GQL_URL)) - LAG - LOOKBACK
		await setOwnerBlockingPosition(position)
	}
	console.debug('owner_ingest position', position)

	do {
		const target = (await gqlHeight(GQL_URL)) - LAG
		if (position < target) {
			await ingestRange(position + 1, target)
			await setOwnerBlockingPosition(position = target)
		}
		await sleep(30_000)
	} while (loop)
}// EO blockOwnerIngest

export const ownerIngestLoop = async () => {
	while (true) {
		try {
			await blockOwnerIngest()
		} catch (e: unknown) {
			console.error(e)
			if (e instanceof Error) {
				let cause = 'unprintable?'
				try { cause = JSON.stringify(e.cause) } catch (_e) { cause = String(e.cause) }
				const printStack = (e instanceof GQLError) ? '' : `\n${e.stack}`
				const source = (e instanceof GQLError) ? ` from ${e.cause?.url || GQL_URL}` : ''
				await slackLog('owner-ingest', `FATAL error ❌ ${e.name}:${e.message}${source} \ncause ${cause} ${printStack} \nrestarting in 30 secs...`)
				await sleepOrig(30_000)
			} else {
				throw e;
			}
		}
	}
}
