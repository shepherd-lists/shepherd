export type Config = {
	region: 'us-east-1', //dummy but required

	/** self-hosted deployment */
	dockerHost: string
	buildPlatform?: string  // e.g. 'linux/amd64' for remote x86 servers
	dbPassword: string
	minioPassword: string
	/** optional pagerduty integration */
	pagerduty_key?: string

	/** optional slack channel notifications */
	slack_webhook?: string
	slack_positive?: string
	slack_probe?: string
	slack_public?: string

	/** per-addon external config, passed as env vars to cron containers */
	externalConfig?: { [addonName: string]: Record<string, string> }

	/** options for general endpoints */
	host_url?: string	//defaults to https://arweave.net
	gql_url?: string	//defaults to https://arweave.net/graphql
	gql_url_secondary?: string	//defaults to https://arweave-search.goldsky.com/graphql

	/** addons to load. foldername must be installed in ./addons/ */
	addons: Array<string>

	/** classifiers and order for linking (names must match `addons` and folder names) */
	classifiers: Array<string>

	// // ## whitelist IPs for http://webserver/blacklist.txt
	txids_whitelist: Array<string>

	/* ranges whitelist ips for nodes */
	http_api_nodes_url?: string //future feature: auto update range lists
	ranges_whitelist: Array<{ name: string, server: string }>

	/* arweave nodes for http api retrieval (fallback host_url).
	* N.B. `name` must be a FQDN (hostname) */
	http_api_nodes: Array<{ name: string, server: string }>

	/* ingress nodes for additional chunk streaming */
	ingress_nodes: Array<{ url: string, name: string }>

	/* gateways to check for blocked data */
	gw_domains?: Array<string>

	/** disable core services */
	services: {
		indexer: boolean
		httpApi: boolean
		webserver: boolean
		checks: boolean
	}

}

/** Docker resource naming convention: `{name}-shep-{stackName}` */
export const naming = (stackName: string, s: string) => `${s}-shep-${stackName}`

/** return the name of the output queue for a given classifier. important to centralize this logic for refactoring later */
export const classifierQueueName = (config: Config, i: number) => ({
	queueName: `shepherd2-output-${i + 1}-${config.classifiers[i]}-q`,
	dlqName: `shepherd2-output-${i + 1}-${config.classifiers[i]}-dlq`,
})

/** determine the i/o queues for a classifier */
export const ioQueueNames = (config: Config, name: string) => {
	const index = config.classifiers.indexOf(name)
	if (index === -1) throw new Error(`Classifier '${name}' not found`)
	if (index === 0) return {
		input: 'shepherd2-input-q', //this is defined in infra/stack.ts
		output: classifierQueueName(config, index).queueName,
	}
	return {
		input: classifierQueueName(config, index - 1).queueName,
		output: classifierQueueName(config, index).queueName,
	}
}

/** last output Q is for http-api input (n.b. may be no classifiers) */
export const finalQueueName = (config: Config): string | undefined =>
	(config.classifiers.length > 0)
		? classifierQueueName(config, config.classifiers.length - 1).queueName
		: undefined
