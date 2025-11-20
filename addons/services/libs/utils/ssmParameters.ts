import { GetParameterCommand, SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm'
import { slackLog } from './slackLog'


const ssm = new SSMClient() //current region
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** n.b. json is the default */
export const readParamJsonLive = async (name: string) => JSON.parse(
	(await ssm.send(new GetParameterCommand({
		Name: `/shepherd/live/${name}`,
		WithDecryption: true, // ignored if unencrypted
	}))).Parameter!.Value as string // throw when undefined
)
/** standard tier string max of 4kb */
export const writeParamJsonLive = async (name: string, value: object) => {
	const Value = JSON.stringify(value)
	if (Value.length > 4096) throw new Error(`Value too long: ${Value.length}`)

	console.info(writeParamJsonLive.name, `DEBUG '/shepherd/live/${name}' <= ${Value}`)

	await ssm.send(new PutParameterCommand({
		Name: `/shepherd/live/${name}`,
		Value,
		Type: 'String',
		Overwrite: true,
	}))
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

