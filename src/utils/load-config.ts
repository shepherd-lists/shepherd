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

	for (const pluginName of jsonConfig.plugins) {
		logger(prefix, `installing '${pluginName}' shepherd plugin...`)
		execSync(`npm install ${pluginName}`, { stdio: 'inherit'})
		logger(prefix, `installed '${pluginName}' shepherd plugin complete.`)

		logger(prefix, `loading '${pluginName}' shepherd plugin...`)
		const plugin: FilterPluginInterface = (await import(pluginName)).default
		plugins.push(plugin)
		logger(prefix, `loading '${pluginName}' shepherd plugin complete.`)

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