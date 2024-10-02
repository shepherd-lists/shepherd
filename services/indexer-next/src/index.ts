import { slackLog } from '../../../libs/utils/slackLog'
import knexCreate from '../../../libs/utils/knexCreate'
import { checkForManuallyModifiedOwners } from './owner-blocking/check-manually-added-owners'
import { assertLists, updateFullTxidsRanges } from '../../../libs/s3-lists/update-lists'
import { ownerIngestLoop } from './owner-blocking/owner-ingest'
import { processBlockedOwnersQueue } from '../../../libs/block-owner/owner-blocking'
import { tipLoop } from './index-by-height'
import { ingestLoop } from './index-by-ingested_at'
import { ownerChecks } from './owner-blocking'



/** check this stuff right at the entrypoint */
if (!process.env.FN_OWNER_BLOCKING) throw new Error('missing env var, FN_OWNER_BLOCKING')
if (!process.env.LISTS_BUCKET) throw new Error('missing env var, LISTS_BUCKET')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const knex = knexCreate()


/** restart on errors */
while (true) {
	try {

		/* knex migrate:latest */
		const [batchNo, logs] = await knex.migrate.latest({
			directory: new URL('../migrations/', import.meta.url).pathname,
			// tableName: 'knex_migrations_wallets',
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

		/** start ingest loops. n.b. never return, have own catch loops */
		ownerIngestLoop()
		ownerChecks()
		// tipLoop({})
		// ingestLoop()

		break;
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(
			'indexer-next startup failed.',
			`Fatal error ❌ ${e.name}:${e.message}\n`,
			e,
			'\nrestarting in 30 seconds...'
		)
		await sleep(30_000)
	}
}
