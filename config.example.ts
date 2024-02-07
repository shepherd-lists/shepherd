import { Config } from './Config'

export const config: Config = {
	region: 'eu-west-1',
	cidr: '10.0.0.0/16',

	plugins: [
		// 'nsfw',
	],

	txids_whitelist: [],

	ranges_whitelist: [],

}