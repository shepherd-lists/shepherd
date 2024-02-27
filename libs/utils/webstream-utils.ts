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
 * returns non-empty lines from a stream. 
 */
export async function* readlineWeb(stream: ReadableStream<ArrayBuffer>) {
	const textStream = stream.pipeThrough(new TextDecoderStream)

	let lastString = ''
	for await (const chunk of iteratorWeb(textStream)) {
		const strings = (lastString + chunk).split('\n')
		lastString = strings.pop() || ''
		if (strings.length === 0) continue;
		if (strings.length === 1) continue;
		for (const s of strings) {
			//return lines
			yield s;
		}
	}
	if (lastString.length > 0) {
		//return the last line 
		yield lastString;
	}
}
