#!/usr/bin/env -S npx tsx
import 'dotenv/config'
import { SQSClient, ReceiveMessageCommand, SendMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { createWriteStream } from 'fs'

const wl = createWriteStream('redrive-logs.log', { encoding: 'utf-8', flags: 'a' })

// Initialize AWS SQS client
const sqsClient = new SQSClient();

// Define the source and destination queue URLs
const srcQueueUrl = process.env.src_url //e.g. `dlq-url`;
const destQueueUrl = process.env.dest_url // e.g. `q-url`; 

/** so you need to call this like:
 * AWS_REGION=your_region src_url=x dest_url=y npx tsx redrive-dlq.ts
 * => use the .env file <=
 */

// Function to receive messages from the source queue
let count = 0
async function receiveMessagesFromQueue(runOnce = true) {
  wl.write(`${new Date()} starting...\n`)
  do {
    try {
      const receiveParams = {
        QueueUrl: srcQueueUrl,
        MaxNumberOfMessages: 10, // Maximum number of messages to retrieve
        WaitTimeSeconds: 10 // Wait time for messages to be available
      };

      const command = new ReceiveMessageCommand(receiveParams);
      const { Messages } = await sqsClient.send(command);

      if (!Messages || Messages.length === 0) {
        console.log('No messages to process.');
        runOnce = false;
        return;
      }

      count += Messages.length
      console.info({ count })
      console.log('txids:')
      Messages.map(m => (JSON.parse(m.Body!) as { Records: [{ s3: { object: { key: string } } }] }).Records.map(rec => console.log(rec.s3.object.key)))


      // Process each message
      await Promise.all(Messages.map(async message => {
        // Send the message to the destination queue
        await sendMessageToQueue(message.Body!);

        // Delete the message from the source queue
        await deleteMessageFromQueue(message.ReceiptHandle!);
      }))

    } catch (error) {
      console.error('Error receiving messages from the queue:', error);
    }
  } while (!runOnce)
}

// Function to send a message to the destination queue
async function sendMessageToQueue(messageBody: string) {
  try {
    const sendParams = {
      QueueUrl: destQueueUrl,
      MessageBody: messageBody
    };

    const command = new SendMessageCommand(sendParams);
    await sqsClient.send(command);

    const keys: string[] = []
      ; (JSON.parse(messageBody) as { Records: [{ s3: { object: { key: string } } }] }).Records.map(rec => keys.push(rec.s3.object.key))
    console.log('Message sent to the destination queue with keys:', keys);
    wl.write(`${new Date()} sent ${JSON.stringify(keys)}\n`)
  } catch (error) {
    console.error('Error sending message to the queue:', error);
  }
}

// Function to delete a message from the source queue
async function deleteMessageFromQueue(receiptHandle: string) {
  try {
    const deleteParams = {
      QueueUrl: srcQueueUrl,
      ReceiptHandle: receiptHandle
    };

    const command = new DeleteMessageCommand(deleteParams);
    await sqsClient.send(command);

    console.log(`Message deleted from the source queue.`);
  } catch (error) {
    console.error('Error deleting message from the queue:', error);
  }
}

// Call the function to start receiving messages from the source queue
receiveMessagesFromQueue(false);
