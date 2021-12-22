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
		logger(prefix, `installing '${installString}' shepherd plugin...`)
		execSync(`npm install ${installString}`, { stdio: 'inherit'})
		logger(prefix, `installed '${installString}' shepherd plugin complete.`)

		//remove org/user detail
		const interArr = installString.split('/')
		let packageName = interArr[interArr.length - 1]
		if(!packageName) throw new Error('Bad plugin string: ' + installString)
		
		//remove version detail
		packageName = packageName.split('@')[0] 

		logger(prefix, `loading '${packageName}' shepherd plugin...`)
		const plugin: FilterPluginInterface = (await import(packageName)).default
		plugins.push(plugin)
		logger(prefix, `loading '${packageName}' shepherd plugin complete.`)

		logger(prefix, 'installed version:')
		const grep = process.platform === 'win32' ? 'findstr' : 'grep'
		execSync(`npm ls --depth=0 | ${grep} ${packageName}`, { stdio: 'inherit' })


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