import { getBlockedTxids } from "./txids-cached"
import https from 'https'


const agent = new https.Agent({
	keepAlive: true, //default false
	// maxSockets: Infinity, //default Infinity
	// maxFreeSockets: 256, //default 256
	// keepAliveMsecs: 1000, //default 1000
})

export const headRequest = async (url: string) => {
	return new Promise((resolve, reject) => {
		const req = https.request(url, {
			method: 'HEAD',
			agent,
			timeout: 0,
		}, async res => {
			if (res.statusCode === 302 && res.headers.location) {
				console.info('redirect', res.headers.location)
				try {
					const redirectStatus = await headRequest(res.headers.location)
					resolve(redirectStatus)
				} catch (err) {
					reject(err)
				}
			} else {
				resolve(res.statusCode)
			}
		})
		req.on('error', (err: Error & { code: string }) => {
			console.error(`${url}, ${err.message}, ${err.code}`)
			reject(err)
		})
		req.on('timeout', () => {
			console.error(`${url}, timeout, aborting...`)
			req.destroy() //also causes error event
		})
		req.end()
	})
}



export const checkServerBlockingTxids = async (domain: string) => {
	const blockedTxids = await getBlockedTxids()

	//DEBUG
	// assume this server is reachable?
	for (const txid of blockedTxids) {
		if (txid.length !== 43) throw new Error(`txid ${txid} length !== 43`) //sanity

		const status = await headRequest(`https://${domain}/${txid}`)
		console.info('txid status', { txid, status })
	}
}
checkServerBlockingTxids('arweave.net')
