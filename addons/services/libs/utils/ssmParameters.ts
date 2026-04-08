import Redis from 'ioredis'

const REDIS_HOST = process.env.REDIS_HOST
if (!REDIS_HOST) throw new Error('missing env var: REDIS_HOST')

const redis = new Redis({ host: REDIS_HOST, keyPrefix: 'shepherd:live:' })

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const readParamJsonLive = async (name: string) => {
	const value = await redis.get(name)
	if (value === null) {
		const err = new Error(`Parameter '${name}' not found`)
		err.name = 'ParameterNotFound'
		throw err
	}
	return JSON.parse(value)
}

export const writeParamJsonLive = async (name: string, value: object) => {
	const serialized = JSON.stringify(value)
	console.info(writeParamJsonLive.name, `DEBUG 'shepherd:live:${name}' <= ${serialized}`)
	await redis.set(name, serialized)
}

/** 
 * move all block owner queue functions here 
 */
export interface BlockOwnerQueueItem {
	owner: string,
	method: 'auto' | 'manual',
}
export const blockOwnerQueueParamName = 'BlockOwnerQueue'
/** init store if necessary */
try {
	await readParamJsonLive(blockOwnerQueueParamName)
} catch (e) {
	if (e instanceof Error && e.name === 'ParameterNotFound') {
		console.info(blockOwnerQueueParamName, 'creating queue state in param store')
		await writeParamJsonLive(blockOwnerQueueParamName, [])
	}
}

export const readBlockOwnerQueue = async () => {
	return readParamJsonLive(blockOwnerQueueParamName) as Promise<BlockOwnerQueueItem[]>
}

/** N.B. there is a concurrency limit of `1` for PutParameter. 
 * To avoid/handle TooManyUpdates error:
 * - write lock in the current service
 * - catch error and retry after delay
 * N.B.2 there's still a problem with atomicity. we should just not be using ssm params in this way.
 */
let _writeLock = false
export const updateBlockOwnerQueue = async (value: BlockOwnerQueueItem, op: 'add' | 'remove') => {
	while (_writeLock) {
		await sleep(100)
	}
	_writeLock = true
	let updated;
	try {

		while (true) {
			try {
				const queue = await readParamJsonLive(blockOwnerQueueParamName) as BlockOwnerQueueItem[]
				if (op === 'add' && queue.find(i => i.owner === value.owner)) {
					console.debug(blockOwnerQueueParamName, `DEBUG ${value.owner} already in queue`)
					return []
				}

				updated = op === 'remove' ? queue.filter(i => i.owner !== value.owner) : [...queue, value]
				await writeParamJsonLive(blockOwnerQueueParamName, updated)
				break;
			} catch (e) {
				if (e instanceof Error && e.name === 'TooManyUpdates') {
					await sleep(100)
					continue;
				}
				throw e;
			}
		}

	} finally {
		_writeLock = false
	}
	return updated;
}

