/**
 * We're running knex migrate:latest here programmatically as it makes most sense.
 * Indexer depends-on Pgdb service. All other services depend-on Indexer
 */
import dbConnection from '../common/utils/db-connection'
import { logger } from '../common/utils/logger'
import { indexer } from './indexer'
import col from 'ansi-colors'
import { arGql } from 'ar-gql'
import { GQL_URL, GQL_URL_SECONDARY, PASS1_CONFIRMATIONS, PASS2_CONFIRMATIONS } from '../common/constants'
import { slackLogger } from '../common/utils/slackLogger'

const knex = dbConnection()

const start = async()=> {
	try{
		/**
		 * Database updates happen here before indexer and other services start
		 */
		logger('migrate', 'applying any knex migrations...')
		const [ batchNo, logs] = await knex.migrate.latest({ directory: `${__dirname}/../../migrations/`})

		if(logs.length !== 0){
			logger('migrate', col.green('Database upgrades complete'), batchNo, logs)
			logger('migrate', 'now running vacuum...')
			await knex.raw('vacuum verbose analyze;')
			const vacResults = await knex.raw('SELECT relname, last_vacuum, last_autovacuum FROM pg_stat_user_tables;')
			for(const row of vacResults.rows){
				logger('vacuum', JSON.stringify(row))
			}
		}else{
			logger('migrate', col.green('Database upgrade not required'), batchNo, logs)
		}

		const seed = await knex.seed.run({ directory: `${__dirname}/../../seeds/`})
		logger('info', 'applied the following seed files', seed)


		/** first pass indexer.
		 * this is bleeding edge for earlier detection times
		 */
		indexer(arGql(GQL_URL), PASS1_CONFIRMATIONS)

		/** second pass indexer
		 * - leave some space from weave head (trail behind) to pick up reorged txs.
		 * - recheck 404s that may have been uploaded since.
		 */
		indexer(arGql(GQL_URL_SECONDARY), PASS2_CONFIRMATIONS)


	}catch(err:unknown){
		const e = err as Error
		logger('Error!', 'migrating/seeding database.', e)
		slackLogger(`Error migrating/seeding database. ${e.name}:${e.message}`, e)
	}
}
start()