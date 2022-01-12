import { execSync } from 'child_process'
import { FilterPluginInterface } from '../shepherd-plugin-interfaces'
import { logger } from './logger'

const prefix = 'load-config'

interface Config {
	plugins: FilterPluginInterface[]
	lowmem: boolean
}
let _config: Config

const config = async()=> {
	if(_config){
		if(process.env.NODE_ENV === 'test') logger(prefix, 'returning cached config')
		return _config
	}

	const jsonConfig = require('../../shepherd.config.json')
	const plugins: FilterPluginInterface[] = []

	for (const installString of jsonConfig.plugins as string[]) {

		/* get package name from install string */

		//remove org/user detail
		const interArr = installString.split('/')
		let packageName = interArr[interArr.length - 1]
		if(!packageName) throw new Error('Bad plugin string: ' + installString)
		
		//remove version detail
		packageName = packageName.split('@')[0] 

		logger(prefix, `installing '${installString}' shepherd plugin...`)
		execSync(`npm list ${packageName} || npm install ${installString}`, { stdio: 'inherit'})
		logger(prefix, `installation of '${installString}' shepherd plugin complete.`)

		logger(prefix, 'installed version:')
		execSync(`npm ls ${packageName}`, { stdio: 'inherit' })

		logger(prefix, `loading '${packageName}' shepherd plugin...`)
		const plugin: FilterPluginInterface = (await import(packageName)).default
		plugins.push(plugin)
		logger(prefix, `loading '${packageName}' shepherd plugin complete.`)



		//early model loading
		plugin.init() 
	}

	_config = {
		plugins,
		lowmem: jsonConfig.lowmem as boolean,
	}
	return _config
}
export default config;