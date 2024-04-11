import { GetParameterCommand, SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm'
import { slackLog } from './slackLog'


const ssm = new SSMClient() //current region
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const readParamLive = async (name: string) => JSON.parse(
	(await ssm.send(new GetParameterCommand({
		Name: `/shepherd/live/${name}`,
		WithDecryption: true, // ignored if unencrypted
	}))).Parameter!.Value as string // throw when undefined
)
/** standard tier string max of 4kb */
const writeParamLive = async (name: string, value: Array<object>) => {
	const Value = JSON.stringify(value)
	if (Value.length > 4096) throw new Error(`Value too long: ${Value.length}`)

	await slackLog(writeParamLive.name, `DEBUG '/shepherd/live/${name}' <= ${Value}`)

	ssm.send(new PutParameterCommand({
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
	await readParamLive(blockOwnerQueueParamName)
} catch (e) {
	if (e instanceof Error && e.name === 'ParameterNotFound') {
		await slackLog(blockOwnerQueueParamName, 'creating queue state in param store')
		await writeParamLive(blockOwnerQueueParamName, [])
	}
}

export const readBlockOwnerQueue = async () => {
	return readParamLive(blockOwnerQueueParamName) as Promise<BlockOwnerQueueItem[]>
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

	while (true) {
		try {
			const queue = await readParamLive(blockOwnerQueueParamName) as BlockOwnerQueueItem[]
			updated = op === 'remove' ? queue.filter(i => i.owner !== value.owner) : [...queue, value]
			await writeParamLive(blockOwnerQueueParamName, updated)
			break;
		} catch (e) {
			if (e instanceof Error && e.name === 'TooManyUpdates') {
				await sleep(100)
				continue;
			}
			throw e;
		}
	}

	_writeLock = false
	return updated;
}

