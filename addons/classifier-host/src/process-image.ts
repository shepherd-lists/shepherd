import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { emitClassifierResult, EmitResultContext } from './emit-result'
import { runPluginChain } from './plugin-chain'
import { s3GetBuffer } from './s3-read'
import { resultSummary } from './result-summary'

export interface ProcessImageContext extends EmitResultContext {
  plugins: FilterPluginInterface[]
  txid: string
  contentType: string
}

export const processImage = async (context: ProcessImageContext) => {
  console.info(context.txid, 'image classify start', context.contentType)
  const buffer = await s3GetBuffer(context.txid)
  const filterResult = await runPluginChain(context.plugins, buffer, context.contentType, context.txid)
  console.info(context.txid, 'image classify result', resultSummary(filterResult))
  await emitClassifierResult(context, context.txid, filterResult)
}

