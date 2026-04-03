/**
 * Listens to MinIO bucket notifications and forwards ObjectCreated events
 * to ElasticMQ (SQS-compatible) input queue, matching the AWS S3→SQS format.
 *
 * Also monitors the input queue age and posts to Slack if messages go unprocessed
 * for too long (mirrors the CloudWatch alarm from the AWS CDK stack).
 */
import { Client } from 'minio'
import { SQSClient, SendMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import type { S3Event, S3EventRecord } from 'aws-lambda'

const {
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_BUCKET,
  SQS_ENDPOINT,
  SQS_INPUT_QUEUE_URL,
  SLACK_WEBHOOK,
} = process.env

if (!MINIO_ENDPOINT || !MINIO_BUCKET || !SQS_ENDPOINT || !SQS_INPUT_QUEUE_URL) {
  throw new Error('Missing required env vars: MINIO_ENDPOINT, MINIO_BUCKET, SQS_ENDPOINT, SQS_QUEUE_URL')
}

const prefix = '[minio2mq]'
console.log(prefix, `starting. bucket=${MINIO_BUCKET} queue=${SQS_INPUT_QUEUE_URL}`)

const minio = new Client({
  endPoint: MINIO_ENDPOINT,
  port: parseInt(MINIO_PORT ?? '9000'),
  useSSL: false,
  accessKey: MINIO_ACCESS_KEY ?? 'shepherd',
  secretKey: MINIO_SECRET_KEY!,
})

const sqs = new SQSClient({
  endpoint: SQS_ENDPOINT,
  region: 'us-east-1',
  credentials: { accessKeyId: 'dummy', secretAccessKey: 'dummy' },
})

const listener = minio.listenBucketNotification(MINIO_BUCKET, '*', '*', ['s3:ObjectCreated:*'])

listener.on('notification', async (record: S3EventRecord) => {
  const key = record.s3.object.key
  const s3event: S3Event = { Records: [record] }
  await sqs.send(new SendMessageCommand({
    QueueUrl: SQS_INPUT_QUEUE_URL,
    MessageBody: JSON.stringify(s3event),
  }))
})

listener.on('error', (err: Error) => {
  console.error(prefix, 'error:', err.message)
  process.exit(1)
})

// --- input queue age monitoring ---

const ALARM_THRESHOLD_SECS = 9_000 // 150 minutes
const CHECK_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

const postSlack = async (text: string) => {
  if (!SLACK_WEBHOOK) return
  await fetch(SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

let alarmFired = false

const checkQueueAge = async () => {
  try {
    const res = await sqs.send(new GetQueueAttributesCommand({
      QueueUrl: SQS_INPUT_QUEUE_URL,
      AttributeNames: ['All'],
    }))
    const ageStr = (res.Attributes as Record<string, string> | undefined)?.ApproximateAgeOfOldestMessage
    if (ageStr === undefined) return
    const age = parseInt(ageStr)

    if (age > ALARM_THRESHOLD_SECS && !alarmFired) {
      alarmFired = true
      const mins = Math.round(age / 60)
      console.warn(prefix, `ALARM: input queue oldest message age ${mins}m (threshold ${ALARM_THRESHOLD_SECS / 60}m)`)
      await postSlack(`:warning: *shepherd input queue alarm*\nOldest message is ${mins} minutes old — indexer may not be consuming.`)
    } else if (age <= ALARM_THRESHOLD_SECS && alarmFired) {
      alarmFired = false
      console.log(prefix, 'OK: input queue age back within threshold')
      await postSlack(`:white_check_mark: *shepherd input queue OK*\nQueue age back within threshold.`)
    }
  } catch (err: any) {
    console.error(prefix, 'queue monitor error:', err.message)
  }
}

setInterval(checkQueueAge, CHECK_INTERVAL_MS)

