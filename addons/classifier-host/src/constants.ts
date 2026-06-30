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

const requiredInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export const ADDON_NAME = required(process.env.ADDON_NAME, 'ADDON_NAME')
export const INPUT_BUCKET = required(process.env.AWS_INPUT_BUCKET, 'AWS_INPUT_BUCKET')
export const INPUT_QUEUE_URL = required(process.env.AWS_SQS_INPUT_QUEUE, 'AWS_SQS_INPUT_QUEUE')
export const SINK_QUEUE_URL = required(process.env.AWS_SQS_SINK_QUEUE, 'AWS_SQS_SINK_QUEUE')
export const OUTPUT_QUEUE_URL = required(process.env.AWS_SQS_OUTPUT_QUEUE, 'AWS_SQS_OUTPUT_QUEUE')

export const MAX_CONCURRENT = requiredInt(process.env.NUM_FILES, 50)
export const VIDEO_CONCURRENCY = requiredInt(process.env.VIDEO_CONCURRENCY, 5)

/* fixed tuning — not exposed as env vars */
export const WAIT_TIME_SECONDS = 20            // SQS long-poll wait (max 20)
export const VISIBILITY_TIMEOUT_SECONDS = 900  // MUST match the queue visibility (infra/elasticmq: 15 min); the heartbeat re-extends by this
export const TMP_DIR = './temp-screencaps/'
