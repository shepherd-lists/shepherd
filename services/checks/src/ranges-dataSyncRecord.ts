import http2 from 'http2'
import tls from 'node:tls'



export async function* iteratorWeb<T>(stream: ReadableStream<T>) {
	const reader = stream.getReader() //lock
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) return
			yield value as T
		}
	} finally {
		reader.releaseLock() //unlock
	}
}

async function* singleKeyJsonStream(body: ReadableStream<Uint8Array>) {
	let buffer = ''

	for await (const chunk of iteratorWeb(body)) {
		buffer += new TextDecoder().decode(chunk)
		let start = 0
		let end
		// Split the buffer into JSON objects using ',' as the delimiter. incredibly specific case!
		while ((end = buffer.indexOf(',', start)) !== -1) {
			const objectString = buffer.substring(start, end).trim()
			try {
				// Attempt to handle the array start '[' and end ']' if present
				const jsonString = objectString.replace(/^\[|\]$/g, '')
				if (jsonString) {
					const object = JSON.parse(jsonString)
					yield object as { [end: string]: string }
				}
			} catch (e) {
				console.error('Error parsing JSON object:', e)
				throw e // not sure we need this
			}
			start = end + 1
		}
		buffer = buffer.substring(start)
	}
	// dont forget the last object
	buffer = buffer.replace(/^\[|\]$/g, '')
	if (buffer.length > 0) {
		yield JSON.parse(buffer) as { [end: string]: string }
	}
}

/** cannot mix http2 and fetch/undici streams in the same process */
export const http2ReadableStream = async (url: string, path: string) => {
	interface RetType {
		headers: http2.IncomingHttpHeaders & http2.IncomingHttpStatusHeader
		status?: number
		ok: boolean
		body?: ReadableStream
	}
	return new Promise<RetType>((resolve, reject) => {
		const client = http2.connect(url, {
			rejectUnauthorized: false,
			/** modifying `tls` options is required for compatibility across various servers */
			createConnection: (authority, options) => {
				console.debug({ authority, options })
				const protocolHttps = authority.protocol === 'https:'
				/* using host with http connnections makes the socket try to handshake & fail */
				const host = protocolHttps ? authority.hostname : undefined
				return tls.connect({
					...options,
					host,
					servername: authority.hostname,
					port: +authority.port || (protocolHttps ? 443 : 80),
					ALPNProtocols: ['h2', 'http/1.1'],
				})
			}
		})
		const req = client.request({
			':path': path,
			'content-type': 'application/json',
		})

		/** log connection errors */
		client.on('error', (err) => {
			console.error('client error:', err)
			reject(err)
		})
		req.on('error', err => {
			console.error('request connection error:', err)
			reject(err)
		})

		req.on('response', (headers, flags) => {

			const readStream = new ReadableStream({
				start(controller) {
					req.on('data', (chunk) => {
						controller.enqueue(chunk)
					})

					req.on('end', () => {
						controller.close()
						client.close()
					})

					req.on('error', (err) => {
						console.error('request stream error:', err)
						controller.error(err)
						client.close()
						reject(err)
					})
				}
			})

			resolve({
				headers,
				status: headers[':status'],
				ok: headers[':status'] === 200,
				body: readStream,
			})
		})

		req.end()
	})
}

export const dataSyncObjectStream = async (domain: string, port: number, protocol: 'http' | 'https' = 'http') => {
	try {
		const res = await http2ReadableStream(`${protocol}://${domain}:${port}`, '/data_sync_record')

		if (!res.ok) throw new Error(`${dataSyncObjectStream.name} bad response: ${res.status}`)

		return singleKeyJsonStream(res.body!)
	} catch (e) {
		throw new Error(`${dataSyncObjectStream.name} UNHANDLED`, { cause: e })
	}
}

// // Usage example
// const iter = await dataSyncObjectStream('arweave.net', 443, 'https')
// let count = 0
// for await (const obj of iter) {
// 	console.debug('obj', obj)
// 	count++
// }
// console.info('total dataSyncRecords', count)

