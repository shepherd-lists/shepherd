import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { emitClassifierResult, EmitResultContext } from './emit-result'
import { runPluginChain } from './plugin-chain'
import { s3GetBuffer } from './s3-read'

export interface ProcessImageContext extends EmitResultContext {
  plugins: FilterPluginInterface[]
  txid: string
  contentType: string
}

export const processImage = async (context: ProcessImageContext) => {
  const buffer = await s3GetBuffer(context.txid)
  const filterResult = await runPluginChain(context.plugins, buffer, context.contentType, context.txid)
  await emitClassifierResult(context, context.txid, filterResult)
}

