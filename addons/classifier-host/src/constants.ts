/**
 * All runtime config comes from env vars injected by the addon's pulumi component
 * (see addons/<addon>/infra/components/AddonComponent.ts). Validated once, here — importing this
 * module throws if a required var is missing. Modules import the constants they need directly;
 * config is never passed around.
 */

const required = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const requiredInt = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`${name} is not configured`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} is not a valid integer`)
  return Math.floor(parsed)
}

export const ADDON_NAME = required(process.env.ADDON_NAME, 'ADDON_NAME')
export const INPUT_BUCKET = required(process.env.AWS_INPUT_BUCKET, 'AWS_INPUT_BUCKET')
export const INPUT_QUEUE_URL = required(process.env.AWS_SQS_INPUT_QUEUE, 'AWS_SQS_INPUT_QUEUE')
export const SINK_QUEUE_URL = required(process.env.AWS_SQS_SINK_QUEUE, 'AWS_SQS_SINK_QUEUE')
export const OUTPUT_QUEUE_URL = required(process.env.AWS_SQS_OUTPUT_QUEUE, 'AWS_SQS_OUTPUT_QUEUE')

export const NUM_FILES = requiredInt(process.env.NUM_FILES, 'NUM_FILES')
export const VIDEO_CONCURRENCY = requiredInt(process.env.VIDEO_CONCURRENCY, 'VIDEO_CONCURRENCY')

/* fixed tuning — not exposed as env vars */
export const WAIT_TIME_SECONDS = 20            // SQS long-poll wait (max 20)
export const VISIBILITY_TIMEOUT_SECONDS = 900  // MUST match the queue visibility (infra/elasticmq: 15 min); the heartbeat re-extends by this
export const TMP_DIR = './temp-screencaps/'
// per-origin socket pool for the aws sdk clients. sdk default is 50 == NUM_FILES, so the workers
// alone can hold every socket; queued requests then wait unbounded (requestTimeout doesn't cover
// socket acquisition). Keep well above NUM_FILES.
export const MAX_SOCKETS = 256
