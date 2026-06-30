import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { extractGifFrames } from './extract-frames'
import { processFileToFrames } from './process-video'

export const processGif = async (
  plugin: FilterPluginInterface,
  txid: string,
) => processFileToFrames(plugin, txid, extractGifFrames, 'gif')
