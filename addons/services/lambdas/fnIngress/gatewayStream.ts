import https from 'node:https'
import { ReadableStream } from 'node:stream/web'
import { min_data_size } from '../../libs/constants'



//reuse connections
const agent = new https.Agent({
	keepAlive: true,
	maxSockets: 100,
	maxFreeSockets: 10,
	timeout: 30_000
})
const no_data_timeout = 30_000


//export function to destroy agent after tests
export const destroyGatewayAgent = () => agent.destroy()

export const gatewayStream = async (
	txid: string,
	abortSignal: AbortSignal,
	httpsGet = https.get, //dependency injection for testing
): Promise<ReadableStream<Uint8Array>> => {
	//try raw endpoint first (no redirects)
	try {
		return await httpsStream(`https://arweave.net/raw/${txid}`, httpsGet, abortSignal)
	} catch {
		//fallback to regular endpoint
		return httpsStream(`https://arweave.net/${txid}`, httpsGet, abortSignal)
	}
}

const httpsStream = (url: string, httpsGet: typeof https.get, abortSignal?: AbortSignal): Promise<ReadableStream<Uint8Array>> => {
	return new Promise((resolve, reject) => {
		httpsGet(url, { agent, signal: abortSignal }, (res) => {
			//handle redirects
			if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
				return resolve(httpsStream(res.headers.location, httpsGet, abortSignal))
			}

			if (res.statusCode !== 200) {
				return reject(new Error(`${url} failed: ${res.statusCode}`))
			}

			let bytesReceived = 0

			//timeout if no data received within timeout period
			res.setTimeout(no_data_timeout, () => {
				if (bytesReceived < min_data_size) {
					console.warn(`${url} data timeout - only ${bytesReceived} bytes received (< ${min_data_size})`)
					res.destroy(new Error('NO_DATA'))
				} else {
					console.warn(`${url} data timeout - ${bytesReceived} bytes received, ending stream`)
					res.destroy(new Error('GRACEFUL')) // End stream gracefully
				}
			})

			const stream = new ReadableStream({
				type: 'bytes',
				start(controller) {
					res.on('data', (chunk: Buffer) => {
						bytesReceived += chunk.length
						controller.enqueue(new Uint8Array(chunk))
					})
					res.on('end', () => controller.close())
					res.on('error', (err: Error) => {
						if (err.message === 'GRACEFUL') {
							return controller.close() //this would be a partial file, potentially still viewable
						}
						if (err.message === 'NO_DATA' || bytesReceived < min_data_size) {
							return controller.error(new Error('NO_DATA'))
						}
						if (err instanceof Error && err.name === 'AbortError') {
							return controller.error(new Error(abortSignal?.reason ?? 'aborted'))
						}
						controller.error(err)
					})
				},
				cancel(reason) {
					console.info(url, 'cancelled stream, reason:', reason)
					res.destroy(reason)
				}
			})

			resolve(stream)
		}).on('error', reject)
	})
}
