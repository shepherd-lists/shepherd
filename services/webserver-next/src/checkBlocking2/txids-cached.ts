import { s3GetObjectWebStream, s3HeadObject } from "../../../../libs/utils/s3-services"
import { slackLog } from "../../../../libs/utils/slackLog"
import { readlineWeb } from "../../../../libs/utils/webstream-utils"


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface TxidCache {
	eTag: string
	txids: Array<string>
	inProgress: boolean
}
const _txidCache: TxidCache = { eTag: '', txids: [], inProgress: false }

export const getBlockedTxids = async () => {
	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, 'blacklist.txt')).ETag!
	console.debug(getBlockedTxids.name, 'eTag', eTag)

	/** short-circuit */
	if (eTag === _txidCache.eTag) {
		console.info(getBlockedTxids.name, 'returning cache')
		return _txidCache.txids
	}

	/** just one running update is allowed/required */
	if (_txidCache.inProgress) {
		console.info(getBlockedTxids.name, 'waiting for cache update as inProgress')
		while (_txidCache.inProgress) {
			await sleep(100) //wait for new cache
		}
		console.info(getBlockedTxids.name, 'returning cache')
		return _txidCache.txids
	}
	_txidCache.inProgress = true

	/** fetch blacklist.txt */

	console.info(getBlockedTxids.name, 'fetching & processing new cache...')
	const t0 = performance.now()

	const stream = await s3GetObjectWebStream(process.env.LISTS_BUCKET!, 'blacklist.txt')
	let txids: Array<string> = []
	for await (const line of readlineWeb(stream)) {
		//DEBUG
		if (line.length === 0) {
			slackLog(getBlockedTxids.name, 'WARNING! empty line retrieving blacklist.txt')
			continue;
		}
		txids.push(line)
	}
	const t1 = performance.now()
	console.info(getBlockedTxids.name, `fetched ${txids.length} txids in ${(t1 - t0).toFixed(0)}ms`)

	_txidCache.txids = txids
	_txidCache.eTag = eTag
	_txidCache.inProgress = false
	console.info(getBlockedTxids.name, 'returning new cache')
	return txids
}