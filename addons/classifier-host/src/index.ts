import './constants' //call early and throw if a required var is missing
import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { startSqsConsumer } from './1-incoming/sqs-consumer'
import { resetVideoTempDir } from './2-processing/process-video'

/**
 * Entry point. All runtime config is read from env-backed constants (see ./constants.ts),
 * and the shared SQS client lives in ./utils/sqs-client.ts — nothing is passed around.
 */
export const runClassifierHost = async (plugin: FilterPluginInterface) => {
  await resetVideoTempDir() //clear any workdirs orphaned by a previous crash before consuming
  return startSqsConsumer(plugin)
}
