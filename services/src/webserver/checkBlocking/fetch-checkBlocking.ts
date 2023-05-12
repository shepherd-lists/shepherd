
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const retryMs = 10_000

/**
 * @param url /path of url to fetch
 * @returns the Response object and AbortController
 * 
 * N.B. this only catches initial connection errors. it's not actually very useful
 */
export const fetch_checkBlocking = async(url: string)=> {
	let res: Response | null = null
	let aborter: AbortController | null = null
	let errCount = 0
	while(true){
		try{
			aborter = new AbortController()
			res = await fetch(url, { signal: aborter.signal })

			const {status, statusText} = res

			if(status === 404) return { res }; //if the data isn't there it isn't there. 
			if(status >= 400 && status < 500){
				console.log(fetch_checkBlocking.name, `Error ${status} bad server response '${statusText}' for ${url} . retrying in ${retryMs} ms...`)
				await sleep(retryMs)
				continue;
			}
			if(status >= 500){
				console.log(fetch_checkBlocking.name, `Error ${status} server error '${statusText}' for ${url}. Not retrying.`)
				return { res }
			}

			return{
				res,
				aborter,
			}
		}catch(e:any){
			errCount++
			if(errCount > 2){
				console.log(fetch_checkBlocking.name, `Error for '${url}'. Retried ${errCount} times. Giving up. ${e.name}:${e.message}`)
				throw new Error(`${fetch_checkBlocking.name} giving up after 3 retries. ${e.name}:${e.message}`)
			}
			//retry all of these connection errors
			console.log(fetch_checkBlocking.name, `Error for '${url}'. ${e.name}:${e.message}. Error count: ${errCount}. Retrying in ${retryMs} ms...`)
			if(e.code && e.code !== 'ECONNREFUSED'){
				console.log(e)
			}
			//clean up any stream resources
			aborter?.abort()
			res && res.body?.cancel()
			//wait for n/w conditions to change
			await sleep(retryMs)
		}
		
	}
}

