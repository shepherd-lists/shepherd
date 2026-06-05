import { rimraf } from 'rimraf'
import { VID_TMPDIR } from '../../constants'
import { logger } from '../../utils/logger'
import { cleanupAfterProcessing, cleanupRelease } from '../../harness'


export interface VidDownloadRecord {
	txid: string
	content_size: string
	content_type: string
	receiptHandle: string
	complete: 'TRUE' | 'FALSE' | 'ERROR'
}

export class VidDownloads implements Iterable<VidDownloadRecord> {

	/* singleton boilerplate */
	private static instance: VidDownloads
	private constructor() { }
	public static getInstance(): VidDownloads {
		if (!VidDownloads.instance) {
			VidDownloads.instance = new VidDownloads()
		}
		return VidDownloads.instance
	}

	/* array we are wrapping */
	private static array: VidDownloadRecord[] = []

	/* expose methods/properties of internal array */
	public [Symbol.iterator] = () => VidDownloads.array[Symbol.iterator]()
	public length = () => VidDownloads.array.length	//it's become a function
	public push = (vdl: VidDownloadRecord) => {
		for (const item of VidDownloads.array) {
			if (vdl.txid === item.txid) {
				throw new Error(`VidDownloadsError: item '${vdl.txid}' already in array.`)
			}
		}
		VidDownloads.array.push(vdl)
	}

	/* extra methods */
	public size = () => VidDownloads.array.reduce((acc, curr) => acc + Number(curr.content_size), 0)

	public cleanup = async (vdl: VidDownloadRecord) => {
		try {
			await rimraf(VID_TMPDIR + vdl.txid)
		} catch (e) {
			logger(vdl.txid, 'Error deleting temp folder', e)
		}
		VidDownloads.array = VidDownloads.array.filter(d => d !== vdl)
		await cleanupAfterProcessing(vdl.receiptHandle, vdl.txid, +vdl.content_size)
	}

	public cleanupNoDelMsg = async (vdl: VidDownloadRecord) => {
		try {
			await rimraf(VID_TMPDIR + vdl.txid)
		} catch (e) {
			logger(vdl.txid, 'Error deleting temp folder', e)
		}
		VidDownloads.array = VidDownloads.array.filter(d => d !== vdl)
	}

	/**
	 * Aborted/errored download: don't delete the SQS message, release it back to the queue so a
	 * later run can retry. Removes from the array first (synchronously) so the harness's
	 * error-sweep loop can't fire this more than once for the same record.
	 */
	public cleanupReleaseMsg = async (vdl: VidDownloadRecord) => {
		if (!VidDownloads.array.includes(vdl)) return //already being cleaned up
		VidDownloads.array = VidDownloads.array.filter(d => d !== vdl)
		try {
			await rimraf(VID_TMPDIR + vdl.txid)
		} catch (e) {
			logger(vdl.txid, 'Error deleting temp folder', e)
		}
		await cleanupRelease(vdl.receiptHandle, +vdl.content_size)
	}

	public listIds = () => {
		const ids: string[] = []
		for (const item of this) {
			ids.push(item.txid)
		}
		return ids
	}
}

