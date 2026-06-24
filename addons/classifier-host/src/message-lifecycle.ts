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

