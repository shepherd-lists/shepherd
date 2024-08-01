import { Config } from './Config'

export const config: Config = {
	region: 'eu-west-1',
	cidr: '10.0.0.0/16',

	addons: [
		// 'nsfw',
	],

	txids_whitelist: [],

	/* required for performing weave range calculations, fallback is host_url */
	http_api_nodes: [],

	ranges_whitelist: [],

	services: {
		indexer: true,
		feeder: true,
		fetchers: true,
		httpApi: true,
		webserver: true,
		checks: false,
	},

}
