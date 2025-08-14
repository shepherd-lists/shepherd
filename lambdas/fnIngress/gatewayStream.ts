import https from 'node:https'


//reuse connections
const agent = new https.Agent({
	keepAlive: true,
	maxSockets: 100,
	maxFreeSockets: 10,
	timeout: 30000
})

//export function to destroy agent after tests
export const destroyAgent = () => agent.destroy()

export async function gatewayStream(txid: string): Promise<ReadableStream<Uint8Array>> {
	//try raw endpoint first (no redirects)
	try {
		return await makeRequest(`https://arweave.net/raw/${txid}`)
	} catch {
		//fallback to regular endpoint
		return await makeRequest(`https://arweave.net/${txid}`)
	}
}

function makeRequest(url: string): Promise<ReadableStream<Uint8Array>> {
	return new Promise((resolve, reject) => {
		https.get(url, { agent }, (res) => {
			//handle redirects
			if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
				resolve(makeRequest(res.headers.location))
				return
			}

			if (res.statusCode !== 200) {
				reject(new Error(`${url} failed: ${res.statusCode}`))
				return
			}

			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					res.on('data', (chunk: Buffer) => {
						controller.enqueue(new Uint8Array(chunk))
					})
					res.on('end', () => controller.close())
					res.on('error', (err: Error) => controller.error(err))
				},
				cancel(reason) {
					console.info(url, 'cancelled stream, reason:', reason)
					res.destroy()
				}
			})

			resolve(stream)
		}).on('error', reject)
	})
}
