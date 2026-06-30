import { PartialPluginResult, PluginResult } from '../types'

/** one-word log summary of a classification result */
export const resultSummary = (result: PluginResult): string => {
  const partial = result as PartialPluginResult
  if (partial.flagged === true) return 'flagged'
  return partial.data_reason ?? 'clean'
}
