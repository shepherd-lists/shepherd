import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { emitClassifierResult, EmitResultContext } from '../3-output/emit-result'
import { classifyImage } from './classify'
import { s3GetBuffer } from '../1-incoming/s3-read'
import { resultSummary } from '../utils/log-result-summary'

export interface ProcessImageContext extends EmitResultContext {
  plugin: FilterPluginInterface
  txid: string
  contentType: string
}

export const processImage = async (context: ProcessImageContext) => {
  console.info(context.txid, 'image classify start', context.contentType)
  const buffer = await s3GetBuffer(context.txid)
  const filterResult = await classifyImage(context.plugin, buffer, context.contentType, context.txid)
  console.info(context.txid, 'image classify result', resultSummary(filterResult))
  await emitClassifierResult(context, context.txid, filterResult)
}

