import { readFile } from 'node:fs/promises'
import { FilterErrorResult, FilterPluginInterface, FilterResult } from 'shepherd-plugin-interfaces'
import { PluginResult } from '../types'

type FlagType = NonNullable<FilterResult['flag_type']>

interface MergeState {
  sawBooleanResult: boolean
  flagged: boolean
  flag_type?: FlagType
  top_score_name?: string
  top_score_value?: number
  firstError?: FilterErrorResult
}

const flagTypePriority = (value: FilterResult['flag_type']) => {
  if (value === 'matched') return 3
  if (value === 'classified') return 2
  if (value === 'test') return 1
  return 0
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

  state.sawBooleanResult = true
  state.flagged = state.flagged || result.flagged
  state.flag_type = mergeFlagType(state.flag_type, result.flag_type)
  mergeScore(state, result)
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

const FRAME_BATCH_SIZE = 5

const classifyFramePath = async (
  plugins: FilterPluginInterface[],
  framePath: string,
  txid: string,
) => runPluginChain(plugins, await readFile(framePath), 'image/png', txid)

export const classifyFrames = async (
  plugins: FilterPluginInterface[],
  framePaths: string[],
  txid: string,
): Promise<PluginResult> => {
  const state: MergeState = {
    sawBooleanResult: false,
    flagged: false,
  }

  const [firstFrame, ...remainingFrames] = framePaths

  /* check the first frame alone: a plugin's first checkImage also seeds its md5 hash cache, so
   * it must run before the rest are fired off in parallel below. */
  if (firstFrame) {
    mergeResults(state, await classifyFramePath(plugins, firstFrame, txid))
  }

  /* process remaining frames in parallel batches, breaking on the first flagged batch */
  for (let i = 0; !state.flagged && i < remainingFrames.length; i += FRAME_BATCH_SIZE) {
    const batch = remainingFrames.slice(i, i + FRAME_BATCH_SIZE)
    const results = await Promise.all(batch.map(framePath => classifyFramePath(plugins, framePath, txid)))
    for (const result of results) {
      mergeResults(state, result)
    }
  }

  return toPluginResult(state)
}

