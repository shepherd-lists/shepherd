import { initTxidsCache, updateTxidsCache } from "../../../../libs/s3-lists/read-lists"
import { UniqTxidArray } from '../../../../libs/s3-lists/ram-lists'
import { s3GetObjectWebStream, s3HeadObject } from "../../../../libs/utils/s3-services"
import { slackLog } from "../../../../libs/utils/slackLog"
import { readlineWeb } from "../../../../libs/utils/webstream-utils"
import { FolderName } from "./types"
import { getLastModified } from "../../../../libs/s3-lists/update-lists"



const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))


interface TxidCache {
	lastModified: number
	txids: UniqTxidArray | undefined
	inProgress: boolean
}
const _txidCaches: { [key: string]: TxidCache } = {}



export const getBlockedTxids = async (folder: FolderName) => {

	const thisModified = await getLastModified(folder)
	console.debug(getBlockedTxids.name, JSON.stringify({ folder, last_modified: thisModified }))

	/** init empty */
	if (!_txidCaches[folder]) {
		_txidCaches[folder] = { lastModified: 0, txids: undefined, inProgress: false }
	}

	/** short-circuit */
	if (thisModified === _txidCaches[folder].lastModified) {
		console.info(getBlockedTxids.name, folder, 'returning cache')
		return _txidCaches[folder].txids
	}

	/** just one running update is allowed/required */
	if (_txidCaches[folder].inProgress) {
		console.info(getBlockedTxids.name, folder, 'waiting for cache update as inProgress')
		while (_txidCaches[folder].inProgress) {
			await sleep(100) //wait for new cache
		}
		console.info(getBlockedTxids.name, folder, 'returning cache')
		return _txidCaches[folder].txids
	}
	_txidCaches[folder].inProgress = true

	/** create/update cache */
	console.info(getBlockedTxids.name, folder, 'create/update cache...')
	const t0 = performance.now()


	if (_txidCaches[folder].txids === undefined) {
		//run init txids
		const { txids, lastModified } = await initTxidsCache(folder)
		_txidCaches[folder] = { txids, lastModified, inProgress: false }
	} else {
		//run update on existing UniqTxidArray
		const { lastModified } = await updateTxidsCache({
			txidsCache: _txidCaches[folder].txids,
			listdir: folder,
			previousModified: thisModified,
		})
		_txidCaches[folder].lastModified = lastModified
	}


	const t1 = performance.now()
	console.info(getBlockedTxids.name, folder, `fetched latest cached txids in ${(t1 - t0).toFixed(0)}ms.`)

	_txidCaches[folder].inProgress = false
	return _txidCaches[folder].txids
}

// getBlockedTxids('txidflagged.txt')
// getBlockedTxids('txidowners.txt')
