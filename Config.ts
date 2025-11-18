export type Config = {
	region: string
	// # vpc cidr. private subnets between regions/stacks will be shared by tailscale
	cidr: string

	/** optional slack channel notifications */
	slack_webhook?: string
	slack_positive?: string
	slack_probe?: string
	slack_public?: string

	/** options for general endpoints */
	host_url?: string	//defaults to https://arweave.net
	gql_url?: string	//defaults to https://arweave.net/graphql
	gql_url_secondary?: string	//defaults to https://arweave-search.goldsky.com/graphql

	/** addonns to load. must be installed in ./addons/ */
	addons: Array<string>

	/** classifiers and order for linking */
	classifiers: Array<string>

	// // ## whitelist IPs for http://webserver/blacklist.txt
	txids_whitelist: Array<string>

	/* ranges whitelist ips for nodes */
	http_api_nodes_url?: string //future feature: auto update range lists
	ranges_whitelist: Array<{ name: string, server: string }>

	/* arweave nodes for http api retrieval (fallback host_url).
	 * N.B. `name` must be a FQDN (hostname) */
	http_api_nodes: Array<{ name: string, server: string }>

	/* gateways to check for blocked data */
	gw_domains?: Array<string>

	/** disable core services */
	services: {
		indexer: boolean
		feeder: boolean
		fetchers: boolean
		httpApi: boolean
		webserver: boolean
		checks: boolean
	}

}
