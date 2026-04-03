/**
 * Listens to MinIO bucket notifications and forwards ObjectCreated events
 * to ElasticMQ (SQS-compatible) input queue, matching the AWS S3→SQS format.
 */
import { Client } from 'minio'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import type { S3Event, S3EventRecord } from 'aws-lambda'

const {
  MINIO_ENDPOINT,
  MINIO_PORT,
  MINIO_ACCESS_KEY,
  MINIO_SECRET_KEY,
  MINIO_BUCKET,
  SQS_ENDPOINT,
  SQS_QUEUE_URL,
} = process.env

if (!MINIO_ENDPOINT || !MINIO_BUCKET || !SQS_ENDPOINT || !SQS_QUEUE_URL) {
  throw new Error('Missing required env vars: MINIO_ENDPOINT, MINIO_BUCKET, SQS_ENDPOINT, SQS_QUEUE_URL')
}

const prefix = '[localbridge]'
console.log(prefix, `starting. bucket=${MINIO_BUCKET} queue=${SQS_QUEUE_URL}`)

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
    QueueUrl: SQS_QUEUE_URL,
    MessageBody: JSON.stringify(s3event),
  }))
})

listener.on('error', (err: Error) => {
  console.error(prefix, 'error:', err.message)
  process.exit(1)
})
