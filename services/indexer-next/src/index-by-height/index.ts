/**
 * this will be the main entry point for indexing by height.
 * it will build on the original indexer, but will use a different strategy to index blocks.
 * the other method (not covered here) indexing by ingest_at, can be considered the "main" indexer - using goldsky.
 * - goldsky excels in completeness using that method
 * - where goldsky is lacking is in latency, especially for base txs.
 * 
 * so this will be an ario based indexer using min/max heights to scan blocks.
 * - it will not be used for backfilling or catchup indexing.
 * - it will only be used for live indexing of new blocks.
 * - it can scan multiple blocks at a time as the numbers should be low, and little if any dataItems unbundled.
 *   -- this will be empirically tested, but max = height && min = height -1, for example.
 * 
 * footnote: this will replace the oldest, and last remaining code from the original shepherd versions!
 */
/** plan:
 * 1. get current ario height
 * 2. scan blocks for min/max heights to index, dispatch to worker lambdas
 * 3. wait for next block height
 * 4. repeat
 * n.b. only latest blocks get queried, goldsky is the main indexer
*/
import { gqlHeight as gqlHeightOrig } from "./gql-height"
import { gqlPages } from "./query-processor"
import { arGql } from 'ar-gql'
const sleepOrig = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


const GQL_URL = process.env.GQL_URL as string //ario by default
const GQL_URL_SECONDARY = process.env.GQL_URL_SECONDARY as string //goldsky by default
console.info(`GQL_URL: ${GQL_URL}`)
console.info(`GQL_URL_SECONDARY : ${GQL_URL_SECONDARY}`)
if (!GQL_URL) throw new Error('GQL_URL not set')
if (!GQL_URL_SECONDARY) throw new Error('GQL_URL_SECONDARY not set')


const MIN_MAX_DIFFERENCE = 1

const ario = arGql({ endpointUrl: GQL_URL, retries: 3 })
const goldsky = arGql({ endpointUrl: GQL_URL_SECONDARY, retries: 3 })


export const tipLoop = async (
	/* dependency injection for test */
	{
		loop = true,
		sleep = sleepOrig,
		gqlHeight = gqlHeightOrig,
		gqlQuery = gqlQueryOrig,
	},
) => {
	let current = await gqlHeight(GQL_URL)
	do {
		/* get ario height */
		console.debug(`current height: ${current}`, new Date().toLocaleTimeString())

		/* query min <=> max blocks  */
		//TODO: gql query that sends off to lambdas
		const min = current - MIN_MAX_DIFFERENCE, max = current
		await gqlQuery({ min, max })

		/* wait for next height */
		let next = await gqlHeight(GQL_URL)

		while (next === current) {
			const waitMs = 30_000
			console.info(`waiting ${waitMs.toLocaleString()} ms for new height...`, { current, next })
			await sleep(waitMs) // wait for next block to be mined
			next = await gqlHeight(GQL_URL)
		}
		current = next //ensures we don't get backlogged, we're only interested in the tip
	} while (loop)
}

const gqlQueryOrig = async ({ min, max }: { min: number, max: number }) => {
	console.debug('querying blocks', { min, max })
	const queryArio = `query($cursor: String, $minBlock: Int, $maxBlock: Int) {
		transactions(
			block: {
				min: $minBlock,
				max: $maxBlock,
			}
			tags: [
				{ name: "Content-Type", values: [
					"image/bmp",
					"image/jpeg",
					"image/jpg",
					"image/png",
					"image/gif",
					"image/tiff",
					"image/webp",
					"image/x-ms-bmp",
					"image/svg+xml",
					"image/apng",
					"image/heic",
					"video/3gpp",
					"video/3gpp2",
					"video/mp2t",
					"video/mp4",
					"video/mpeg",
					"video/ogg",
					"video/quicktime",
					"video/webm",
					"video/x-flv",
					"video/x-m4v",
					"video/x-msvideo",
					"video/x-ms-wmv",
				] }
			]
			first: 100
			after: $cursor
		) {
			pageInfo { hasNextPage }
			edges {
				cursor
				node{
					id
					data{ size type }
					tags{ name value }
					block{ height }
					parent{ id }
					owner{ address }
				}
			}
		}
	}`
	const variables = {
		minBlock: min,
		maxBlock: max,
	}

	//call generic handler
	await gqlPages({
		query: queryArio,
		variables,
		indexName: 'indexer_tip',
		gql: ario,
		gqlBackup: goldsky,
	})


}