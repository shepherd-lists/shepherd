

const http_api_nodes_url = process.env.http_api_nodes_url

type Http_Api_Nodes = Array<{
	name: string //dns name
	server: string //ip address
	url?: string // complete node url `http://${name}:1984`
	throttled?: EpochTimeStamp // used in /offsets
}>
/* populate with env var if exists */
let _nodes = (JSON.parse(process.env.http_api_nodes || '[]') as Http_Api_Nodes).map(n => ({ ...n, url: `http://${n.name}:1984` }))

/** cron function */
const checkEndpoint = async () => {
	if (!http_api_nodes_url) {
		return console.debug(`http_api_nodes_url is not set. using http_api_nodes=${JSON.stringify(_nodes)}`)
	}

	try {
		const nodes: Http_Api_Nodes = await fetch(http_api_nodes_url).then(res => res.json().then(j => j))

		_nodes = nodes.map(n => ({ ...n, url: `http://${n.name}:1984` }))
		console.debug({ _nodes })
	} catch (e) {
		console.error(`error fetching http_api_nodes_url=${http_api_nodes_url}`)
		throw e
	}
}
await checkEndpoint() //run straight away to populate
const interval = 1000 * 60 * 60 // once an hour 
setInterval(checkEndpoint, interval)

/** use a cron to check for updates. update on access too complicated/costly for the consumers */


/** other modules will only read the updated array */
export const httpApiNodes = () => _nodes

