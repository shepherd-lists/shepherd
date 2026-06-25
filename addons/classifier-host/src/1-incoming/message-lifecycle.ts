import { ChangeMessageVisibilityCommand, DeleteMessageCommand, SQSClient } from '@aws-sdk/client-sqs'

export const ackMessage = async (
  sqsClient: SQSClient,
  queueUrl: string,
  receiptHandle: string,
) => sqsClient.send(new DeleteMessageCommand({
  QueueUrl: queueUrl,
  ReceiptHandle: receiptHandle,
}))

export const releaseMessage = async (
  sqsClient: SQSClient,
  queueUrl: string,
  receiptHandle: string,
) => sqsClient.send(new ChangeMessageVisibilityCommand({
  QueueUrl: queueUrl,
  ReceiptHandle: receiptHandle,
  VisibilityTimeout: 10, //10s backoff before retry
}))

/**
 * Keep an in-flight message invisible while it waits for a video slot and/or processes for longer
 * than the queue's visibility timeout. Without this a long/queued job would be redelivered, inflate
 * the receive count, and eventually be sent to the DLQ. Returns a stop function for the `finally`.
 */
export const startVisibilityHeartbeat = (
  sqsClient: SQSClient,
  queueUrl: string,
  receiptHandle: string,
  visibilityTimeoutSeconds: number,
) => {
  const intervalMs = Math.max(1, Math.floor(visibilityTimeoutSeconds / 3)) * 1000
  const timer = setInterval(() => {
    sqsClient.send(new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeoutSeconds,
    })).catch((error: unknown) => {
      const e = error as Error
      console.error('visibility heartbeat failed', e.name, e.message)
    })
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

