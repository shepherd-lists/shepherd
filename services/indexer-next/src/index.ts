import { slackLog } from './utils/slackLog'
import { createInfractionsTable } from './utils/owner-table-utils'
import { blockOwnerHistory } from './owner-blocking'
import knexCreate from './utils/knexCreate'


const knex = knexCreate()

if (!process.env.FN_OWNER_TABLE) throw new Error('missing env var, FN_OWNER_TABLE')

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))



/** restart on errors */
let runonce = true
while (true) {
	try {

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

		if (runonce) {
			const owner = 'v2XXwq_FvVqH2KR4p_x8H-SQ7rDwZBbykSv-59__Avc'

			// console.info('create infractions table.')
			// const infractionsTable = await createInfractionsTable(owner)
			// console.info('infractions table created.')

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
