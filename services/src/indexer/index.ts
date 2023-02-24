/**
 * We're running knex migrate:latest here programmatically as it makes most sense.
 * Indexer depends-on Pgdb service. All other services depend-on Indexer
 */
import dbConnection from '../common/utils/db-connection'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { indexer } from './indexer'
import col from 'ansi-colors'
import arGql from 'ar-gql'
import { GQL_URL, GQL_URL_SECONDARY, INDEX_FIRST_PASS, INDEX_SECOND_PASS } from '../common/constants'

const db = dbConnection()

const start = async()=> {
	try{
		/**
		 * Database updates happen here before indexer and other services start
		 */
		const [ batchNo, logs] = await db.migrate.latest({ directory: `${__dirname}/../../migrations/`})
		
		if(logs.length !== 0){
			logger('migrate', col.green('Database upgrades complete'), batchNo, logs)
		}else{
			logger('migrate', col.green('Database upgrade not required'), batchNo, logs)
		}

		const seed = await db.seed.run({ directory: `${__dirname}/../../seeds/`})
		logger('info', 'applied the following seed files', seed)
		
		
		/** first pass indexer.
		 * this is bleeding edge for earlier detection times
		 */
		indexer(arGql(GQL_URL), INDEX_FIRST_PASS)

		/** second pass indexer
		 * - leave some space from weave head (trail behind) to pick up reorged txs.
		 * - recheck 404s that may have been uploaded since.
		 */
		indexer(arGql(GQL_URL_SECONDARY), INDEX_SECOND_PASS)

		
		//TODO! recheck 404s 
		//TODO! recheck 404s - need to bring height checking into this module?
		//TODO! recheck 404s 


		
	}catch(e){
		logger('Error!', 'error upgrading database', e)
	}
}
start()