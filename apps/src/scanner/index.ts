/**
 * We're running knex migrate:latest here programmatically as it makes most sense.
 * Scanner depends-on Pgdb service. All other services depend-on Scanner
 */
import dbConnection from '../utils/db-connection'
import { logger } from '../utils/logger'
import { scanner } from './scanner'
import col from 'ansi-colors'

const db = dbConnection()

const start = async()=> {
	try{
		/**
		 * Database updates happen here before scanner and other services start
		 */
		const [ batchNo, logs] = await db.migrate.latest({ directory: `${__dirname}/../../migrations/`})
		
		if(logs.length !== 0){
			logger('migrate', col.green('Database upgrades complete'), batchNo, logs)
		}else{
			logger('migrate', col.green('Database upgrade not required'), batchNo, logs)
		}

		const seed = await db.seed.run({ directory: `${__dirname}/../../seeds/`})
		logger('info', 'applied the following seed files', seed)
		
		scanner()
		
	}catch(e){
		logger('Error!', 'error upgrading database', e)
	}
}
start()