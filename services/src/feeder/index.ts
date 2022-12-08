import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { slackLogger } from '../common/utils/slackLogger'
import si from 'systeminformation'
import { feeder } from './feeder'

const prefix = 'feeder'

const main = async()=> {
	try{

		await feeder()

	}catch(e){
		if(e instanceof Error){
			logger(prefix, 'Unhandled error in main!\t', e.name, ':', e.message)
			console.log(e)
			slackLogger(prefix, 'Unhandled error in main!\t', e.name, ':', e.message)
		}else{
			logger(prefix, 'Unhandled in main!\t', JSON.stringify(e))
			slackLogger(prefix, 'Unhandled in main!\t', JSON.stringify(e))
		}
		logger(prefix, await si.mem())
	}
}
main()
