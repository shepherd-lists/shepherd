import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { emitClassifierResult } from '../3-output/emit-result'
import { classifyImage } from './classify'
import { s3GetBuffer } from '../1-incoming/s3-read'
import { resultSummary } from '../utils/log-result-summary'

export const processImage = async (
  plugin: FilterPluginInterface,
  txid: string,
  contentType: string,
) => {
  console.info(txid, 'image classify start', contentType)
  const buffer = await s3GetBuffer(txid)
  const filterResult = await classifyImage(plugin, buffer, contentType, txid)
  console.info(txid, 'image classify result', resultSummary(filterResult))
  await emitClassifierResult(txid, filterResult)
}
