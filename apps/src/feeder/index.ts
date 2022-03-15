require('dotenv').config() //first line of entrypoint
import loadConfig from '../utils/load-config'
import { logger } from '../utils/logger'
import { slackLogger } from '../utils/slackLogger'
import si from 'systeminformation'

const prefix = 'feeder'

const main = async()=> {
	try{

		const config = await loadConfig() // this calls the init functions early

		// feeder(config.lowmem)

	}catch(e){
		if(e instanceof Error){
			logger(prefix, 'Unhandled error in main!\t', e.name, ':', e.message)
			slackLogger(prefix, 'Unhandled error in main!\t', e.name, ':', e.message)
		}else{
			logger(prefix, 'Unhandled in main!\t', JSON.stringify(e))
			slackLogger(prefix, 'Unhandled in main!\t', JSON.stringify(e))
		}
		logger(prefix, await si.mem())
	}
}
main()