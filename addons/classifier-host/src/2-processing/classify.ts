import { readFile } from 'node:fs/promises'
import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { PluginResult } from '../types'

export const classifyImage = async (
  plugin: FilterPluginInterface,
  buffer: Buffer,
  mime: string,
  txid: string,
): Promise<PluginResult> => plugin.checkImage(buffer, mime, txid)

const FRAME_BATCH_SIZE = 5

export const classifyFrames = async (
  plugin: FilterPluginInterface,
  framePaths: string[],
  framesDir: string,
  txid: string,
): Promise<PluginResult> => {
  /* if the plugin can classify a whole frame folder itself, hand it off and let it own
   * everything (batching, batch size, tensor lifecycle, early-exit). Plugins without this
   * (e.g. iwf) fall through to the per-frame loop below. */
  if (typeof plugin.checkImageDir === 'function') {
    return plugin.checkImageDir(framesDir, 'image/png', txid)
  }

  let firstError: PluginResult | undefined

  /* check the first frame alone: the plugin's first checkImage also seeds its md5 hash cache, so
   * it must run before the rest are fired off in parallel below. */
  const [firstFrame, ...remainingFrames] = framePaths
  if (firstFrame) {
    const result = await classifyImage(plugin, await readFile(firstFrame), 'image/png', txid)
    if (result.flagged) return result
    if (result.flagged === undefined && !firstError) firstError = result
  }

  /* process remaining frames in parallel batches; the first flagged frame wins and we stop */
  for (let i = 0; i < remainingFrames.length; i += FRAME_BATCH_SIZE) {
    const batch = remainingFrames.slice(i, i + FRAME_BATCH_SIZE)
    const results = await Promise.all(batch.map(async framePath =>
      classifyImage(plugin, await readFile(framePath), 'image/png', txid)))
    for (const result of results) {
      if (result.flagged) return result
      if (result.flagged === undefined && !firstError) firstError = result
    }
  }

  return firstError ?? { flagged: false }
}
