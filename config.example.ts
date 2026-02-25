import { Config } from './Config'

export const config: Config = {
	region: 'eu-west-1',
	cidr: '10.0.0.0/16',

	addons: [
		'nsfw',
		'services',
	],

	/** classifiers and order for linking */
	classifiers: [
		'nsfw'
	],

	txids_whitelist: [],

	/* required for performing weave range calculations, fallback is host_url */
	http_api_nodes: [],

	ingress_nodes: [],

	ranges_whitelist: [],

	services: {
		indexer: true,
		httpApi: true,
		webserver: true,
		checks: false,
	},

}
