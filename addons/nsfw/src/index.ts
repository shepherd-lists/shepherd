import { harness } from './harness'
import si from 'systeminformation'
import { logger } from './utils/logger'
import { slackLogger } from './utils/slackLogger'

const prefix = 'harness'

const main = async()=> {
	try{
		harness()
		
	}catch(e){
		logger(prefix, await si.mem())
		if(e instanceof Error){
			logger(prefix, `Unhandled error in ${main.name}!\t`, e.name, ':', e.message)
			slackLogger(prefix, `Unhandled error in ${main.name}!\t`, e.name, ':', e.message)
		}else{
			logger(prefix, `Unhandled in ${main.name}!\t`, JSON.stringify(e))
			slackLogger(prefix, `Unhandled in ${main.name}!\t`, JSON.stringify(e))
		}
	}	
}
main()
