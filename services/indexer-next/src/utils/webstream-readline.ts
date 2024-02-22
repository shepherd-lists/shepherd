import { iteratorWeb } from './webstream-iterator.js'

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
