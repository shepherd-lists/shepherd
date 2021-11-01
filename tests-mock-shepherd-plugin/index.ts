import { FilterPluginInterface, FilterResult } from '../src/shepherd-plugin-interfaces'

const mockPlugin: FilterPluginInterface = {
	init: async()=>console.log('mock init called'),
	checkImage: async(buffer: Buffer, mimetype: string, txid: string):Promise<FilterResult>=>{
		console.log('mock checkImage called')
		return { flagged: false	}
	}
}

export default mockPlugin;