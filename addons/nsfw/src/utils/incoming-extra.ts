import { FilterResult } from "shepherd-plugin-interfaces"

const incomingExtras = new Map<string, { addonName: string, filterResult: FilterResult }>()

export const setIncomingExtra = (txid: string, extra: { addonName: string, filterResult: FilterResult }) => {
	if (extra) incomingExtras.set(txid, extra)
}

export const getAndDeleteIncomingExtra = (txid: string) => {
	const extra = incomingExtras.get(txid)
	incomingExtras.delete(txid)
	return extra
}
