import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { SQSClient } from '@aws-sdk/client-sqs'
import { NodeHttpHandler } from '@aws-sdk/node-http-handler'
import { MAX_SOCKETS } from '../constants'

/**
 * Single process-wide SQS client. Import this everywhere instead of constructing
 * or passing a client around. `AWS_ENDPOINT_URL_SQS` is honoured for local/dev (elasticmq).
 */
const endpoint = process.env.AWS_ENDPOINT_URL_SQS

export const sqsClient = new SQSClient({
  ...(endpoint ? { endpoint } : {}),
  maxAttempts: 10,
  requestHandler: new NodeHttpHandler({
    httpAgent: new HttpAgent({ keepAlive: true, maxSockets: MAX_SOCKETS }),
    httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: MAX_SOCKETS }),
  }),
})
