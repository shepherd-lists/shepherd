import { SQSClient } from '@aws-sdk/client-sqs'
import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { startSqsConsumer } from './1-incoming/sqs-consumer'
import { ClassifierHostConfig, ClassifierHostRuntime } from './types'

/* fixed tuning — not exposed as env vars */
const WAIT_TIME_SECONDS = 20            // SQS long-poll wait (max 20)
const VISIBILITY_TIMEOUT_SECONDS = 900  // MUST match the queue visibility (infra/elasticmq: 15 min); the heartbeat re-extends by this
const TMP_DIR = './temp-screencaps/'

const required = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const toPositiveInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/** config is supplied as env vars by the addon's pulumi component (see infra/components/AddonComponent.ts) */
const resolveConfig = (): ClassifierHostConfig => {
  return {
    addonName: required(process.env.ADDON_NAME, 'ADDON_NAME'),
    inputBucket: required(process.env.AWS_INPUT_BUCKET, 'AWS_INPUT_BUCKET'),
    inputQueueUrl: required(process.env.AWS_SQS_INPUT_QUEUE, 'AWS_SQS_INPUT_QUEUE'),
    outputQueueUrl: required(process.env.AWS_SQS_OUTPUT_QUEUE, 'AWS_SQS_OUTPUT_QUEUE'),
    sinkQueueUrl: required(process.env.AWS_SQS_SINK_QUEUE, 'AWS_SQS_SINK_QUEUE'),
    maxConcurrent: toPositiveInt(process.env.NUM_FILES, 50),
    waitTimeSeconds: WAIT_TIME_SECONDS,
    visibilityTimeoutSeconds: VISIBILITY_TIMEOUT_SECONDS,
    videoConcurrency: toPositiveInt(process.env.VIDEO_CONCURRENCY, 5),
    tmpDir: TMP_DIR,
  }
}

const createSqsClient = () => {
  const endpoint = process.env.AWS_ENDPOINT_URL_SQS
  return new SQSClient({
    ...(endpoint ? { endpoint } : {}),
    maxAttempts: 10,
  })
}

export const runClassifierHost = async (plugin: FilterPluginInterface) => {
  const runtime: ClassifierHostRuntime = {
    config: resolveConfig(),
    plugin,
    sqsClient: createSqsClient(),
  }

  return startSqsConsumer(runtime)
}
