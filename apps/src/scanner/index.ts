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
		const migrate = await db.migrate.latest({ directory: './migrations/'})
		const status = migrate[0]
		if(status === 1){
			logger('migrate', col.green('Database upgrades complete'), migrate[1])
		}else if(status === 2){
			logger('migrate', col.green('Database upgrade not required'), migrate[1])
		}

		const seed = await db.seed.run({ directory: './seeds/'})
		logger('info', 'applied the following seed files', seed)
		
		scanner()
		
	}catch(e){
		logger('Error!', 'error upgrading database', e)
	}
}
start()