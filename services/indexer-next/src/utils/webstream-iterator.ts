/** 
 * web streams in the browser dont have an iterator yet. 
*/
export async function* iteratorWeb<T>(stream: ReadableStream<T>){
	const reader = stream.getReader() //lock 
	try{
		while(true){
			const {done, value} = await reader.read()
			if(done) return;
			yield value as T;
		}
	}finally{
		reader.releaseLock() //unlock
	}
}
