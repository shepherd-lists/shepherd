import rimraf from "rimraf"
import { VID_TMPDIR } from "../../constants"
import { logger } from "../../utils/logger"
import { cleanupAfterProcessing } from "../../harness"


export interface VidDownloadRecord  {
	txid: string
	content_size: string
	content_type: string
	receiptHandle: string
	complete: 'TRUE' | 'FALSE' | 'ERROR' | (string & {})
}

export class VidDownloads implements Iterable<VidDownloadRecord> {
	
	/* singleton boilerplate */
	private static instance: VidDownloads
	private constructor(){}
	public static getInstance(): VidDownloads {
		if(!VidDownloads.instance){
			VidDownloads.instance = new VidDownloads()
		}
		return VidDownloads.instance;
	}

	/* array we are wrapping */
	private static array: VidDownloadRecord[] = []

	/* expose methods/properties of internal array */
	public [Symbol.iterator] = ()=> VidDownloads.array[Symbol.iterator]()
	public length = ()=> VidDownloads.array.length	//it's become a function
	public push = (vdl: VidDownloadRecord)=> {
		for (const item of VidDownloads.array) {
			if(vdl.txid === item.txid){
				throw new Error(`VidDownloadsError: item '${vdl.txid}' already in array.`)
			}
		}
		VidDownloads.array.push(vdl)
	}

	/* extra methods */
	public size = ()=> VidDownloads.array.reduce((acc, curr)=> acc + Number(curr.content_size), 0)

	public cleanup = (vdl: VidDownloadRecord)=> {
		rimraf(VID_TMPDIR + vdl.txid, (e)=> e && logger(vdl.txid, 'Error deleting temp folder', e))
		VidDownloads.array = VidDownloads.array.filter(d => d !== vdl)
		//cleanupAfterProcessing is not being called in certain cases. let's see if nextTick helps
		process.nextTick(() => cleanupAfterProcessing(vdl.receiptHandle, vdl.txid, +vdl.content_size))
	}

	public listIds = ()=> {
		let ids: string[] = []
		for (const item of this) {
			ids.push(item.txid)
		}
		return ids
	}
}

