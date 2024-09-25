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
import { gqlHeight } from "./gql-height"
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const GQL_URL = process.env.GQL_URL as string //ario by default
console.info(`GQL_URL: ${GQL_URL}`)
if (!GQL_URL) throw new Error('GQL_URL not set')

const MIN_MAX_DIFFERENCE = 1

export const tipLoop = async (loop = true) => {
	let current = await gqlHeight(GQL_URL)
	do {
		/* get ario height */
		console.debug(`current height: ${current}`, new Date().toLocaleTimeString())

		/* query min <=> max blocks  */
		//TODO: gql query that sends off to lambdas
		const min = current - MIN_MAX_DIFFERENCE, max = current
		console.debug('querying blocks', { min, max })

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

