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
		const res = await db.migrate.latest({ directory: './migrations/'})
		const status = res[0]
		if(status === 1){
			logger('info', col.green('Database upgrades complete'), res[1])
		}else if(status === 2){
			logger('info', col.green('Database upgrade not required'), res[1])
		}
		
		scanner()
		
	}catch(e){
		logger('Error!', 'error upgrading database', e)
	}
}
start()