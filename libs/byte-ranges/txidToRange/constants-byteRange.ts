/* for use in calculating byte ranges */
export const CHUNK_ALIGN_GENESIS = 30607159107830n //weave address where enforced 256kb chunks started
export const CHUNK_SIZE = 262144n //256kb

export const GQL_URL_SECONDARY = process.env.GQL_URL_SECONDARY!
export const GQL_URL = process.env.GQL_URL!
if (!GQL_URL_SECONDARY) throw new Error(`Missing env var, GQL_URL_SECONDARY:${GQL_URL_SECONDARY}`)
if (!GQL_URL) throw new Error(`Missing env var, GQL_URL:${GQL_URL}`)


/** 
 * do some crude gw url switching for test purposes
*/

export let HOST_URL = 'https://arweave.net'

const gwUrls: `https://${string}`[] = [
	'https://arweave.net',
	// 'https://ar-io.net', //it's arweave.net
	'https://permagate.io',
	'https://vilenarios.com',
]
let index = 0
const getNext = () => {
	index++
	if (index >= gwUrls.length) {
		index = 0
	}
	return index
}
export const hostUrlRateLimited = async (current: string) => {
	if (current !== HOST_URL) {
		//already changed
		return
	}
	const previous = HOST_URL
	const next = getNext()
	HOST_URL = gwUrls[next]!
	console.info(`HOST_URL switching ${previous} => ${HOST_URL}`)
}
