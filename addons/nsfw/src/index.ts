import { harness } from './harness'
import si from 'systeminformation'
import { logger } from './utils/logger'
import { slackLogger } from './utils/slackLogger'
import rimraf from 'rimraf'
import { VID_TMPDIR } from './constants'
import loadConfig from './utils/load-config'

const prefix = 'harness'

const main = async()=> {
	try{

		//clean up tempdir from previous run
		rimraf(VID_TMPDIR + '*', (e)=> {
			if(e) logger(prefix, 'error: could not clean', VID_TMPDIR, JSON.stringify(e))
		})

		const config = await loadConfig() // this calls the init functions early

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
