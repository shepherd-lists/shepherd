import { IncomingExtra } from '../types'

const incomingExtras = new Map<string, IncomingExtra>()

export const setIncomingExtra = (txid: string, extra: IncomingExtra | undefined) => {
  if (extra) incomingExtras.set(txid, extra)
}

export const getAndDeleteIncomingExtra = (txid: string) => {
  const extra = incomingExtras.get(txid)
  incomingExtras.delete(txid)
  return extra
}

