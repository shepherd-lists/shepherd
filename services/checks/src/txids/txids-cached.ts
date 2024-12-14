import { s3GetObjectWebStream, s3HeadObject } from "../../../../libs/utils/s3-services"
import { slackLog } from "../../../../libs/utils/slackLog"
import { readlineWeb } from "../../../../libs/utils/webstream-utils"



const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


interface TxidCache {
	eTag: string
	ids: Array<string>
	inProgress: boolean
}
const _txidCaches: { [key: string]: TxidCache } = {}



export const getBlockedTxids = async (key: ('txidflagged.txt' | 'txidowners.txt' | `${string}/txids.txt`)) => {
	/** create an empty entry */
	if (!_txidCaches[key]) {
		_txidCaches[key] = { eTag: '', ids: [], inProgress: false }
	}

	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, key)).ETag!
	console.debug(getBlockedTxids.name, key, 'eTag', eTag)

	/** short-circuit */
	if (eTag === _txidCaches[key].eTag) {
		console.info(getBlockedTxids.name, key, 'returning cache')
		return _txidCaches[key].ids
	}

	/** just one running update is allowed/required */
	if (_txidCaches[key].inProgress) {
		console.info(getBlockedTxids.name, key, 'waiting for cache update as inProgress')
		while (_txidCaches[key].inProgress) {
			await sleep(100) //wait for new cache
		}
		console.info(getBlockedTxids.name, key, 'returning cache')
		return _txidCaches[key].ids
	}
	_txidCaches[key].inProgress = true

	/** fetch blacklist.txt */

	console.info(getBlockedTxids.name, `fetching & processing new ${key} cache...`)
	const t0 = performance.now()

	const stream = await s3GetObjectWebStream(process.env.LISTS_BUCKET!, key)
	const ids: string[] = []

	for await (const txid of readlineWeb(stream)) {
		//debug/sanity check (older code suggested possible empty lines?)
		if (txid.length !== 43) {
			slackLog(getBlockedTxids.name, key, `WARNING! skipping invalid txid '${txid}'`)
			continue;
		}

		ids.push(txid)
	}

	const t1 = performance.now()
	console.info(getBlockedTxids.name, key, `fetched ${ids.length} txids in ${(t1 - t0).toFixed(0)}ms. returning new cache`)

	_txidCaches[key].ids = ids
	_txidCaches[key].eTag = eTag
	_txidCaches[key].inProgress = false
	return ids
}

// getBlockedTxids('txidflagged.txt')
// getBlockedTxids('txidowners.txt')
