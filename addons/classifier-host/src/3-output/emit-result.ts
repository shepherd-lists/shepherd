import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { S3EventRecord } from 'aws-lambda'
import { getAndDeleteIncomingExtra } from '../1-incoming/incoming-extra'
import { resultSummary } from '../utils/log-result-summary'
import { PartialPluginResult, PluginResult } from '../types'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

let sendCounter = 0

/** last path segment of an SQS URL, for readable logs */
const queueShortName = (queueUrl: string) => queueUrl.split('/').filter(Boolean).pop() ?? queueUrl

const shouldSendToNextClassifier = (
  filterResult: PartialPluginResult,
  outputQueueUrl: string,
  sinkQueueUrl: string,
) => {
  if (outputQueueUrl === sinkQueueUrl) return false
  return filterResult.data_reason === 'corrupt-maybe'
    || filterResult.data_reason === 'partial'
    || filterResult.data_reason === 'oversized'
    || filterResult.data_reason === 'unsupported'
}

const mergeIncomingTopScore = (
  current: PartialPluginResult,
  previous: PartialPluginResult | undefined,
) => {
  if (!previous || current.flagged !== false) return current
  if (typeof previous.top_score_value !== 'number' || !previous.top_score_name) return current
  if (typeof current.top_score_value === 'number' && current.top_score_value >= previous.top_score_value) return current
  return {
    ...current,
    top_score_name: previous.top_score_name,
    top_score_value: previous.top_score_value,
  }
}

const queueForResult = (
  filterResult: PartialPluginResult,
  outputQueueUrl: string,
  sinkQueueUrl: string,
) => {
  if (filterResult.flagged === true) return outputQueueUrl
  if (shouldSendToNextClassifier(filterResult, outputQueueUrl, sinkQueueUrl)) return outputQueueUrl
  return sinkQueueUrl
}

export interface EmitResultContext {
  sqsClient: SQSClient
  inputBucket: string
  outputQueueUrl: string
  sinkQueueUrl: string
  addonName: string
}

export const emitClassifierResult = async (
  context: EmitResultContext,
  txid: string,
  initialResult: PluginResult,
) => {
  const previousExtra = getAndDeleteIncomingExtra(txid)
  const initialPartial = initialResult as PartialPluginResult
  const filterResult = mergeIncomingTopScore(initialPartial, previousExtra?.filterResult)
  const queueUrl = queueForResult(filterResult, context.outputQueueUrl, context.sinkQueueUrl)
  const queueName = queueShortName(queueUrl)

  const s3Event = {
    Records: [{
      eventVersion: '2.1',
      eventSource: 'aws:s3',
      eventName: 'ObjectCreated:Put',
      eventTime: new Date().toISOString(),
      s3: {
        s3SchemaVersion: '1.0',
        bucket: {
          name: context.inputBucket,
          arn: `arn:aws:s3:::${context.inputBucket}`,
        },
        object: {
          key: txid,
          size: 0,
        },
      },
    }] as S3EventRecord[],
    extra: {
      addonName: context.addonName,
      filterResult,
    },
  }

  const sendNum = ++sendCounter
  console.info(txid, `sending ${sendNum} to SQS`, queueName, resultSummary(filterResult as PluginResult))

  let lastError: Error | undefined
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const sendResult = await context.sqsClient.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(s3Event),
      }))
      console.info(txid, `sent ${sendNum} to SQS`, queueName, sendResult.MessageId)
      return sendResult.MessageId
    } catch (error) {
      lastError = error as Error
      console.error(txid, `send ${sendNum} to SQS attempt ${attempt} failed`, queueName, lastError.name, lastError.message)
      if (attempt < 3) {
        await sleep(attempt * 1000)
        continue
      }
    }
  }

  throw lastError ?? new Error(`Failed to send classifier output for txid ${txid}`)
}

