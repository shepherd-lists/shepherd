import { ChangeMessageVisibilityCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs'
import { sqsClient } from '../utils/sqs-client'
import { INPUT_QUEUE_URL, VISIBILITY_TIMEOUT_SECONDS } from '../constants'

export const ackMessage = async (receiptHandle: string) => sqsClient.send(new DeleteMessageCommand({
  QueueUrl: INPUT_QUEUE_URL,
  ReceiptHandle: receiptHandle,
}))

export const releaseMessage = async (receiptHandle: string) => sqsClient.send(new ChangeMessageVisibilityCommand({
  QueueUrl: INPUT_QUEUE_URL,
  ReceiptHandle: receiptHandle,
  VisibilityTimeout: 10, //10s backoff before retry
}))

/**
 * Keep an in-flight message invisible while it waits for a video slot and/or processes for longer
 * than the queue's visibility timeout. Without this a long/queued job would be redelivered, inflate
 * the receive count, and eventually be sent to the DLQ. Returns a stop function for the `finally`.
 */
export const startVisibilityHeartbeat = (receiptHandle: string) => {
  const intervalMs = Math.max(1, Math.floor(VISIBILITY_TIMEOUT_SECONDS / 3)) * 1000
  const timer = setInterval(() => {
    sqsClient.send(new ChangeMessageVisibilityCommand({
      QueueUrl: INPUT_QUEUE_URL,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
    })).catch((error: unknown) => {
      const e = error as Error
      console.error('visibility heartbeat failed', e.name, e.message)
    })
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
