

const http_api_nodes_url = process.env.http_api_nodes_url

type Http_Api_Nodes = Array<{ name: string; server: string }>
let _nodes: Array<Http_Api_Nodes> = JSON.parse(process.env.http_api_nodes || '[]') //populate with env var if exists

/** cron function */
const checkEndpoint = async () => {
	if (!http_api_nodes_url) {
		return console.debug(`http_api_nodes_url is not set. using http_api_nodes=${JSON.stringify(_nodes)}`)
	}

	try {
		_nodes = await fetch(http_api_nodes_url).then(res => res.json().then(j => j))
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
export let httpApiNodes = () => _nodes
