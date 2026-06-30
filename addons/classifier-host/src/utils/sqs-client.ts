import { SQSClient } from '@aws-sdk/client-sqs'

/**
 * Single process-wide SQS client. Import this everywhere instead of constructing
 * or passing a client around. `AWS_ENDPOINT_URL_SQS` is honoured for local/dev (elasticmq).
 */
const endpoint = process.env.AWS_ENDPOINT_URL_SQS

export const sqsClient = new SQSClient({
  ...(endpoint ? { endpoint } : {}),
  maxAttempts: 10,
})
