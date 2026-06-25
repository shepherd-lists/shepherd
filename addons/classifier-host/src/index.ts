import { SQSClient } from '@aws-sdk/client-sqs'
import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { startSqsConsumer } from './1-incoming/sqs-consumer'
import { ClassifierHostConfig, ClassifierHostRuntime } from './types'

const required = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const toPositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export interface RunClassifierHostOptions {
  addonName?: string
  inputBucket?: string
  inputQueueUrl?: string
  outputQueueUrl?: string
  sinkQueueUrl?: string
  maxConcurrent?: number
  waitTimeSeconds?: number
  visibilityTimeoutSeconds?: number
  videoConcurrency?: number
  tmpDir?: string
  ffmpegPath?: string
}

const resolveConfig = (options: RunClassifierHostOptions): ClassifierHostConfig => {
  const sinkQueueUrl = options.sinkQueueUrl ?? process.env.AWS_SQS_SINK_QUEUE
  const outputQueueUrl = options.outputQueueUrl ?? process.env.AWS_SQS_OUTPUT_QUEUE ?? sinkQueueUrl

  return {
    addonName: options.addonName ?? process.env.ADDON_NAME ?? 'classifier-host',
    inputBucket: options.inputBucket ?? required(process.env.AWS_INPUT_BUCKET, 'AWS_INPUT_BUCKET'),
    inputQueueUrl: options.inputQueueUrl ?? required(process.env.AWS_SQS_INPUT_QUEUE, 'AWS_SQS_INPUT_QUEUE'),
    outputQueueUrl: required(outputQueueUrl, 'AWS_SQS_OUTPUT_QUEUE'),
    sinkQueueUrl: required(sinkQueueUrl, 'AWS_SQS_SINK_QUEUE'),
    maxConcurrent: options.maxConcurrent ?? toPositiveInt(process.env.NUM_FILES, 50),
    waitTimeSeconds: options.waitTimeSeconds ?? 20,
    visibilityTimeoutSeconds: options.visibilityTimeoutSeconds ?? 900,
    videoConcurrency: options.videoConcurrency ?? toPositiveInt(process.env.VIDEO_CONCURRENCY, 5),
    tmpDir: options.tmpDir ?? './temp-screencaps/',
    ffmpegPath: options.ffmpegPath ?? 'ffmpeg',
  }
}

const createSqsClient = () => {
  const endpoint = process.env.AWS_ENDPOINT_URL_SQS
  return new SQSClient({
    ...(endpoint ? { endpoint } : {}),
    maxAttempts: 10,
  })
}

export const runClassifierHost = async (
  plugin: FilterPluginInterface,
  options: RunClassifierHostOptions = {},
) => {
  const runtime: ClassifierHostRuntime = {
    config: resolveConfig(options),
    plugin,
    sqsClient: createSqsClient(),
  }

  return startSqsConsumer(runtime)
}

