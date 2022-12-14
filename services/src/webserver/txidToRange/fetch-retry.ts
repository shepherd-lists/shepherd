import { fetch, Response } from 'undici'
import { slackLogger } from '../../common/utils/slackLogger'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const retryMs = 10_000

/**
 * @param url /path of url to fetch
 * @returns the Response object and AbortController
 * 
 * N.B. this only catches initial connection errors. it's not actually very useful
 */
export const fetchRetryConnection = async(url: string)=> {
	let res: Response | null = null
	let aborter: AbortController | null = null
	let connErrCount = 0
	while(true){
		try{
			aborter = new AbortController()
			res = await fetch(url, { signal: aborter.signal })

			const {status, statusText} = res

			if(status === 404) return { res }; //if the data isn't there it isn't there. bad data_root?
			if(status >= 400){
				console.log(fetchRetryConnection.name, `Error ${status} bad server response '${statusText}' for ${url} . retrying in ${retryMs} ms...`)
				await sleep(retryMs)
				continue;
			}

			return{
				res,
				aborter,
			}
		}catch(e:any){
			connErrCount++
			if(connErrCount > 30){
				slackLogger(fetchRetryConnection.name, `Error for '${url}'. Already retried 30 times over 5m. Giving up.`)
				console.log(fetchRetryConnection.name, `Error for '${url}'. Already retried 30 times over 5m. Giving up.`)
				throw new Error(`${fetchRetryConnection.name} giving up after 30 retries. ${e.message}`)
			}
			//retry all of these connection errors
			console.log(fetchRetryConnection.name, `Error for '${url}'. Retrying in ${retryMs} ms...`)
			console.log(e)
			//clean up any stream resources
			aborter?.abort()
			res && res.body?.cancel()
			//wait for n/w conditions to change
			await sleep(retryMs)
		}
		
	}
}

export const fetchFullRetried = async(url: string, type: ('json'|'arraybuffer') = 'json')=> {
	while(true){
		try{
			const res = await fetch(url, )

			const {status, statusText} = res

			if(status === 404) return { status }; //if the data isn't there it isn't there. bad data_root?
			if(status >= 400){
				console.log(fetchFullRetried.name, `Error ${status} bad server response '${statusText}' for '${url}'. retrying in ${retryMs} ms...`)
				await sleep(retryMs)
				continue;
			}

			if(type === 'arraybuffer') return {
				status,
				arraybuffer: await res.arrayBuffer(),
			}

			return{
				status,
				json: await res.json(),
			}
		}catch(e:any){
			//retry all of these connection errors
			console.log(fetchFullRetried.name, `Error for '${url}'. Retrying in ${retryMs} ms...`)
			console.log(e)
			await sleep(retryMs)
		}
	}
}
