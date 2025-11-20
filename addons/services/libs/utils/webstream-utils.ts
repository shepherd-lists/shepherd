/** 
 * web streams in the browser dont have an iterator yet. 
*/
export async function* iteratorWeb<T>(stream: ReadableStream<T>) {
	const reader = stream.getReader() //lock 
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) return;
			yield value as T;
		}
	} finally {
		reader.releaseLock() //unlock
	}
}

/**
 * returns lines from a web stream. 
 */
export async function* readlineWeb(stream: ReadableStream<ArrayBuffer>) {
	const textStream = stream.pipeThrough(new TextDecoderStream)

	let lastString = ''
	for await (const chunk of iteratorWeb(textStream)) {
		const strings = (lastString + chunk).split('\n')

		// console.debug(readlineWeb.name, 'strings', strings)

		lastString = strings.pop() || ''

		// console.debug(readlineWeb.name, 'strings', strings)
		// console.debug('lastString', lastString)

		for (const s of strings) {
			// console.debug('s', s)
			//return lines
			yield s;
		}
	}
	// console.debug('lastString', lastString)
	if (lastString.length > 0) {
		//return the last line 
		yield lastString;
	}
}

/** returns stream chunks, one stream after another */
export async function* concatReadableStreams(readables: ReadableStream[]) {
	for (let readable of readables) {
		for await (const chunk of iteratorWeb(readable)) {
			yield chunk;
		}
	}
}
