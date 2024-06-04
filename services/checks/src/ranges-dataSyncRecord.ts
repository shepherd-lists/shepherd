//no imports

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


export const dataSyncObjectStream = async (domain: string, port: number) => {
	try {
		const res = await fetch(`http://${domain}:${port}/data_sync_record`, {
			headers: { 'content-type': 'application/json' },
		})
		if (!res.ok) throw new Error(`${dataSyncObjectStream.name} bad response: ${res.status} ${res.statusText}`)

		return singleKeyJsonStream(res.body!)
	} catch (e) {
		throw new Error(`${dataSyncObjectStream.name} UNHANDLED`, { cause: e })
	}
}

// // Usage example
// const iter = await dataSyncObjectStream('arweave.net', 80)
// let count = 0
// for await (const obj of iter) {
// 	console.debug('obj', obj)
// 	count++
// }
// console.info('total dataSyncRecords', count)

