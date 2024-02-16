import { slackLog } from './utils/slackLog'
import { createInfractionsTable } from './utils/owner-table-utils'
import { blockOwnerHistory } from './owner-blocking'



if (!process.env.FN_OWNER_TABLE) throw new Error('missing env var, FN_OWNER_TABLE')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))



/** restart on errors */
let runonce = true
while (true) {
	try {

		if (runonce) {
			console.info('create infractions table.')
			const owner = 'v2XXwq_FvVqH2KR4p_x8H-SQ7rDwZBbykSv-59__Avc'
			// const infractionsTable = await createInfractionsTable(owner)
			console.info('infractions table created.')

			console.info('run block owner history.')

			await blockOwnerHistory(owner)

			runonce = false
		}


		console.info('nothing to do. sleeping for 50 seconds...')
		await new Promise(resolve => setTimeout(resolve, 50_000))


	} catch (err: unknown) {
		const e = err as Error
		slackLog(
			`Fatal error occurred: ${e.name}:${e.message}\n`,
			JSON.stringify(e, null, 2),
			'\nrestarting in 30 seconds...'
		)
		await sleep(30_000)
	}
}
