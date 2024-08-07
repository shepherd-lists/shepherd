import { slackLog } from '../../utils/slackLog'
import { HOST_URL } from './constants-byteRange'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const retryMs = 10_000

/**
 * @param url /path of url to fetch
 * @returns the Response object and AbortController
 *
 * N.B. this only catches initial connection errors. it's not actually very useful
 */
export const fetchRetryConnection = async (path: string) => {
	let res: Response | null = null
	let aborter: AbortController | null = null
	let connErrCount = 0
	while (true) {
		try {
			aborter = new AbortController()
			res = await fetch(HOST_URL + path, { signal: aborter.signal })

			const { status, statusText } = res

			if (status === 404) return { res } //if the data isn't there it isn't there. bad data_root?
			if (status >= 400) {
				console.log(fetchRetryConnection.name, `Error ${status} bad server response '${statusText}' for ${HOST_URL + path} . retrying in ${retryMs} ms...`)
				await sleep(retryMs)
				continue
			}

			return {
				res,
				aborter,
			}
		} catch (err: unknown) {
			const e = err as Error
			connErrCount++
			const limit = 3
			if (connErrCount > limit) {
				slackLog(fetchRetryConnection.name, `Error for '${HOST_URL + path}'. Already retried ${limit} times. Giving up. ${e.name}:${e.message}`)
				throw new Error(`${fetchRetryConnection.name} giving up after ${limit} retries. ${e.message}`)
			}
			//retry all of these connection errors
			console.log(fetchRetryConnection.name, `Error for '${HOST_URL + path}'. ${e.name}:${e.message}. Retrying in ${retryMs} ms...`)
			console.log(e)
			//clean up any stream resources
			aborter?.abort()
			res && res.body?.cancel()
			//wait for n/w conditions to change
			await sleep(retryMs)
		}

	}
}

export const fetchFullRetried = async (path: string, type: ('json' | 'arraybuffer') = 'json') => {
	while (true) {
		const url = HOST_URL + path
		let res: Response | undefined
		try {
			res = await fetch(url)

			const { status, statusText } = res

			if (status === 404) return { status } //if the data isn't there it isn't there. bad data_root?
			if (status >= 400) {
				console.log(fetchFullRetried.name, `Error ${status} bad server response '${statusText}' for '${url}'. retrying in ${retryMs} ms...`)
				await sleep(retryMs)
				continue
			}

			if (type === 'arraybuffer') return {
				status,
				arraybuffer: await res.arrayBuffer(),
			}

			return {
				status,
				json: await res.json(),
			}
		} catch (err: unknown) {
			const e = err as Error
			//retry all of these connection errors
			console.log(fetchFullRetried.name, `Error for '${url}'. Retrying in ${retryMs} ms...`)
			console.log(e)
			await sleep(retryMs)
		} finally {
			if (res?.body && !res.bodyUsed) {
				res.body.cancel()
			}
		}
	}
}
