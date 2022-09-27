import rimraf from "rimraf"
import { VID_TMPDIR } from "../../constants"
import { TxRecord } from "shepherd-plugin-interfaces/types"
import { logger } from "../../utils/logger"


export interface VidDownloadRecord extends TxRecord {
	complete: 'TRUE' | 'FALSE' | 'ERROR' | (string & {})
	retried: boolean
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
				throw new Error("VidDownloadsError: item already in array")//{ name: "VidDownloadsError", message: "item already in array"}
			}
		}
		VidDownloads.array.push(vdl)
	}

	/* extra methods */
	public size = ()=> VidDownloads.array.reduce((acc, curr)=> acc + Number(curr.content_size), 0)

	public cleanup = (vdl: VidDownloadRecord)=> {
		rimraf(VID_TMPDIR + vdl.txid, (e)=> e && logger(vdl.txid, 'Error deleting temp folder', e))
		VidDownloads.array = VidDownloads.array.filter(d => d !== vdl)
	}

	public listIds = ()=> {
		let ids: number[] = []
		for (const item of this) {
			ids.push(item.id)
		}
		return ids
	}
}

