import { slackLog } from "./slackLog"

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const http_api_nodes_url = process.env.http_api_nodes_url

export type Http_Api_Node = {
	name: string //dns name
	server: string //ip address
	url?: string // complete node url `http://${name}:1984`
}
/* populate with env var if exists */
let _nodes = (JSON.parse(process.env.http_api_nodes || '[]') as Array<Http_Api_Node>).map(n => ({ ...n, url: `http://${n.name}:1984` }))
let _rangeItems = JSON.parse(process.env.RANGELIST_ALLOWED || '[]') as Array<Http_Api_Node>
let _rangeItemIps = _rangeItems.map(r => r.server)

/** cron function */
const checkEndpoint = async () => {
	if (!http_api_nodes_url) {
		return console.debug(`http_api_nodes_url is not set. using http_api_nodes=${JSON.stringify(_nodes)}`)
	}

	let retries = 3
	while (true) {
		try {
			const nodes: Http_Api_Node[] = await fetch(http_api_nodes_url).then(res => res.json().then(j => j))

			_nodes = nodes.map(n => ({ ...n, url: `http://${n.name}:1984` }))
			const rangeItems = [..._nodes, ..._rangeItems.filter(ri => !_nodes.some(n => n.name === ri.name))]
			_rangeItems = rangeItems
			_rangeItemIps = rangeItems.map(r => r.server)
			console.info('httpApiNodes', JSON.stringify(_nodes))
			console.info('rangeItems', JSON.stringify(_rangeItems))
			break;
		} catch (err: unknown) {
			const e = err as Error
			if (--retries === 0) {
				await slackLog(`error fetching http_api_nodes_url=${http_api_nodes_url}`, `cause:= ${e.name}:${e.message}`)
				throw new Error(`error fetching http_api_nodes_url=${http_api_nodes_url}`, { cause: e })
			}
			const timeout = 10_000
			console.error(`error fetching http_api_nodes_url=${http_api_nodes_url}. retrying in ${timeout}ms`, e)
			await sleep(timeout)
		}
	}
}
await checkEndpoint() //run straight away to populate
const interval = 1000 * 60 * 60 // once an hour 
if (http_api_nodes_url) { //if no url, no point checking (makes tests stop also)
	setInterval(checkEndpoint, interval)
}

/** use a cron to check for updates. update on access too complicated/costly for the consumers */


/** other modules can just read the updated arrays */

/** for http/offset */
export const httpApiNodes = () => _nodes

/** range items */
export const rangeAllowed = () => _rangeItems

export const rangeAllowedIps = () => _rangeItemIps

