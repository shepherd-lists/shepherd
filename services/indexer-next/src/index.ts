import { slackLog } from '../../../libs/utils/slackLog'
import { createInfractionsTable } from '../../../libs/block-owner/owner-table-utils'
import { blockOwnerHistory } from '../../../libs/block-owner/owner-blocking'
import knexCreate from '../../../libs/utils/knexCreate'
import { checkForManuallyModifiedOwners } from './services/check-manually-added-owners'
import { assertLists, updateFullTxidsRanges, updateAddresses } from '../../../libs/s3-lists/update-lists'
import { blockOwnerIngest } from './owner-ingest'



/** check this stuff right at the entrypoint */
if (!process.env.FN_OWNER_BLOCKING) throw new Error('missing env var, FN_OWNER_BLOCKING')
if (!process.env.LISTS_BUCKET) throw new Error('missing env var, LISTS_BUCKET')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const knex = knexCreate()


/** restart on errors */
let runonce = true
while (true) {
	try {

		if (runonce) {
			/* knex migrate:latest */
			const [batchNo, logs] = await knex.migrate.latest({
				directory: new URL('../migrations/', import.meta.url).pathname,
				tableName: 'knex_migrations_wallets',
			})
			if (logs.length !== 0) {
				console.info('migrate >>', 'Database upgrades complete', batchNo, logs)
				console.info('migrate >>', 'now running vacuum...')
				await knex.raw('vacuum verbose analyze;')
				const vacResults = await knex.raw('SELECT relname, last_vacuum, last_autovacuum FROM pg_stat_user_tables;')
				for (const row of vacResults.rows) {
					console.info('migrate >> vacuum results:', JSON.stringify(row))
				}
			} else {
				console.info('migrate >>', 'Database upgrade not required', batchNo, logs)
			}

			/** initialise lists if necessary */
			await assertLists()

			/** start block-owner-ingest loop (needs try-catch) */
			blockOwnerIngest() //this async never returns!

			runonce = false
		}

		/** this should be in a setInterval with it's own try-catch */
		const modified = await checkForManuallyModifiedOwners()

		/** check if lists need to be updated */
		if (modified) {
			console.info('owners manually modified. recreating lists')
			const ownersAdded = await updateAddresses()
			const updateLists = await updateFullTxidsRanges()

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
