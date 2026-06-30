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

/** ensure no entry is left behind when a worker returns before emitting (e.g. missing object) */
export const deleteIncomingExtra = (txid: string) => {
  incomingExtras.delete(txid)
}

