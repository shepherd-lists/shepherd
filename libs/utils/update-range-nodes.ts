

const http_api_nodes_url = process.env.http_api_nodes_url

export type Http_Api_Node = {
	name: string //dns name
	server: string //ip address
	url?: string // complete node url `http://${name}:1984`
}
/* populate with env var if exists */
let _nodes = (JSON.parse(process.env.http_api_nodes || '[]') as Array<Http_Api_Node>).map(n => ({ ...n, url: `http://${n.name}:1984` }))
let _rangeItems = JSON.parse(process.env.RANGELIST_ALLOWED || '[]') as Array<Http_Api_Node>

/** cron function */
const checkEndpoint = async () => {
	if (!http_api_nodes_url) {
		return console.debug(`http_api_nodes_url is not set. using http_api_nodes=${JSON.stringify(_nodes)}`)
	}

	try {
		const nodes: Http_Api_Node[] = await fetch(http_api_nodes_url).then(res => res.json().then(j => j))

		_nodes = nodes.map(n => ({ ...n, url: `http://${n.name}:1984` }))
		const rangeItems = [..._nodes, ..._rangeItems.filter(ri => !_nodes.some(n => n.name === ri.name))]
		_rangeItems = rangeItems
		console.info('httpApiNodes', JSON.stringify(_nodes))
		console.info('rangeItems', JSON.stringify(_rangeItems))
	} catch (e) {
		console.error(`error fetching http_api_nodes_url=${http_api_nodes_url}`)
		throw e
	}
}
await checkEndpoint() //run straight away to populate
const interval = 1000 * 60 * 60 // once an hour 
setInterval(checkEndpoint, interval)

/** use a cron to check for updates. update on access too complicated/costly for the consumers */


/** other modules can just read the updated arrays */

/** for http/offset */
export const httpApiNodes = () => _nodes

/** range items */
export const rangeAllowed = () => _rangeItems

