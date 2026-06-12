import { readFile } from 'node:fs/promises'
import { FilterErrorResult, FilterPluginInterface, FilterResult } from 'shepherd-plugin-interfaces'
import { PluginResult } from './types'

type FlagType = NonNullable<FilterResult['flag_type']>

interface MergeState {
  sawBooleanResult: boolean
  flagged: boolean
  flag_type?: FlagType
  top_score_name?: string
  top_score_value?: number
  firstError?: FilterErrorResult
}

const FALSE_POSITIVE_PORN_SCORES = new Set([
  0.903248131275177,
  0.9651741981506348,
  0.9032477140426636,
  0.9885595440864563,
])

const flagTypePriority = (value: FilterResult['flag_type']) => {
  if (value === 'matched') return 3
  if (value === 'classified') return 2
  if (value === 'test') return 1
  return 0
}

const applyLegacyFalsePositiveFilter = (result: FilterResult): FilterResult => {
  if (
    result.flagged === true &&
    result.top_score_name === 'Porn' &&
    typeof result.top_score_value === 'number' &&
    FALSE_POSITIVE_PORN_SCORES.has(result.top_score_value)
  ) {
    return {
      ...result,
      flagged: false,
      top_score_name: undefined,
      top_score_value: undefined,
    }
  }
  return result
}

const mergeFlagType = (current: FlagType | undefined, incoming: FilterResult['flag_type']) => {
  if (!incoming) return current
  if (!current) return incoming
  return flagTypePriority(incoming) > flagTypePriority(current) ? incoming : current
}

const mergeScore = (state: MergeState, result: FilterResult) => {
  if (typeof result.top_score_value !== 'number') return state
  if (typeof state.top_score_value !== 'number' || result.top_score_value > state.top_score_value) {
    state.top_score_value = result.top_score_value
    state.top_score_name = result.top_score_name
  }
  return state
}

export const mergeResults = (state: MergeState, result: PluginResult): MergeState => {
  if (result.flagged === undefined) {
    if (!state.firstError && !state.sawBooleanResult) {
      state.firstError = result
    }
    return state
  }

  const normalized = applyLegacyFalsePositiveFilter(result)
  state.sawBooleanResult = true
  state.flagged = state.flagged || normalized.flagged
  state.flag_type = mergeFlagType(state.flag_type, normalized.flag_type)
  mergeScore(state, normalized)
  return state
}

const toPluginResult = (state: MergeState): PluginResult => {
  if (state.sawBooleanResult) {
    return {
      flagged: state.flagged,
      ...(state.flag_type ? { flag_type: state.flag_type } : {}),
      ...(state.top_score_name ? { top_score_name: state.top_score_name } : {}),
      ...(typeof state.top_score_value === 'number' ? { top_score_value: state.top_score_value } : {}),
    }
  }

  if (state.firstError) return state.firstError
  return { flagged: false }
}

export const runPluginChain = async (
  plugins: FilterPluginInterface[],
  buffer: Buffer,
  mime: string,
  txid: string,
): Promise<PluginResult> => {
  const state: MergeState = {
    sawBooleanResult: false,
    flagged: false,
  }

  for (const plugin of plugins) {
    const result = await plugin.checkImage(buffer, mime, txid)
    mergeResults(state, result)
  }

  return toPluginResult(state)
}

export const classifyFrames = async (
  plugins: FilterPluginInterface[],
  framePaths: string[],
  txid: string,
): Promise<PluginResult> => {
  const state: MergeState = {
    sawBooleanResult: false,
    flagged: false,
  }

  for (const framePath of framePaths) {
    const frameBuffer = await readFile(framePath)
    const frameResult = await runPluginChain(plugins, frameBuffer, 'image/png', txid)
    mergeResults(state, frameResult)
    if (state.flagged) break
  }

  return toPluginResult(state)
}

