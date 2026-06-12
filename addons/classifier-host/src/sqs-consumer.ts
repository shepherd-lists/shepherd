import { Message, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { FilterErrorResult } from 'shepherd-plugin-interfaces'
import { slackLog } from '../../services/libs/utils/slackLog'
import { emitClassifierResult } from './emit-result'
import { setIncomingExtra } from './incoming-extra'
import { ackMessage, releaseMessage } from './message-lifecycle'
import { processImage } from './process-image'
import { processVideo } from './process-video'
import { FatalS3AccessError, MissingObjectError, s3HeadObject } from './s3-read'
import { ClassifierHostRuntime, ParsedS3QueueMessage, RetryableJobError, S3EventLike } from './types'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const parseMessage = (message: Message): ParsedS3QueueMessage => {
  if (!message.Body || !message.ReceiptHandle) {
    throw new Error(`Invalid SQS message: missing Body or ReceiptHandle (id=${message.MessageId})`)
  }

  const parsed = JSON.parse(message.Body) as S3EventLike
  const key = parsed.Records?.[0]?.s3?.object?.key
  if (!key || typeof key !== 'string') {
    throw new Error(`Invalid S3 event payload: missing txid in message ${message.MessageId}`)
  }

  return {
    txid: key,
    receiptHandle: message.ReceiptHandle,
    incomingExtra: parsed.extra,
  }
}

interface WorkerState {
  activeTxids: Set<string>
  activeVideoBytes: number
}

const reserveVideoBytes = (state: WorkerState, maxBytes: number, bytes: number) => {
  if (bytes <= 0) return 0
  if ((state.activeVideoBytes + bytes) > maxBytes) {
    return -1
  }
  state.activeVideoBytes += bytes
  return bytes
}

const releaseVideoBytes = (state: WorkerState, reservedBytes: number) => {
  if (reservedBytes <= 0) return
  state.activeVideoBytes = Math.max(0, state.activeVideoBytes - reservedBytes)
}

const processMessageWorker = async (
  runtime: ClassifierHostRuntime,
  message: Message,
  state: WorkerState,
) => {
  let parsed: ParsedS3QueueMessage
  try {
    parsed = parseMessage(message)
  } catch (error) {
    const receipt = message.ReceiptHandle
    await slackLog('classifier-host', 'parseMessage', 'dropping malformed message', (error as Error).message)
    if (receipt) {
      await ackMessage(runtime.sqsClient, runtime.config.inputQueueUrl, receipt)
    }
    return
  }

  const { txid, receiptHandle, incomingExtra } = parsed
  if (state.activeTxids.has(txid)) {
    await releaseMessage(runtime.sqsClient, runtime.config.inputQueueUrl, receiptHandle)
    return
  }

  state.activeTxids.add(txid)
  let reservedVideoBytes = 0

  try {
    setIncomingExtra(txid, incomingExtra)

    const head = await s3HeadObject(txid)
    const contentType = head.contentType || 'application/octet-stream'
    const isImage = contentType.startsWith('image/')
    const isVideo = contentType.startsWith('video/')

    if (isVideo) {
      const reserved = reserveVideoBytes(state, runtime.config.totalFileSizeBytes, head.contentLength)
      if (reserved < 0) {
        await releaseMessage(runtime.sqsClient, runtime.config.inputQueueUrl, receiptHandle)
        return
      }
      reservedVideoBytes = reserved
    }

    if (isImage) {
      await processImage({
        sqsClient: runtime.sqsClient,
        inputBucket: runtime.config.inputBucket,
        outputQueueUrl: runtime.config.outputQueueUrl,
        sinkQueueUrl: runtime.config.sinkQueueUrl,
        addonName: runtime.config.addonName,
        plugins: runtime.plugins,
        txid,
        contentType,
      })
    } else if (isVideo) {
      await processVideo({
        sqsClient: runtime.sqsClient,
        inputBucket: runtime.config.inputBucket,
        outputQueueUrl: runtime.config.outputQueueUrl,
        sinkQueueUrl: runtime.config.sinkQueueUrl,
        addonName: runtime.config.addonName,
        plugins: runtime.plugins,
        txid,
        ffmpegPath: runtime.config.ffmpegPath,
        tmpRootDir: runtime.config.tmpDir,
      })
    } else {
      await emitClassifierResult({
        sqsClient: runtime.sqsClient,
        inputBucket: runtime.config.inputBucket,
        outputQueueUrl: runtime.config.outputQueueUrl,
        sinkQueueUrl: runtime.config.sinkQueueUrl,
        addonName: runtime.config.addonName,
      }, txid, { flagged: undefined, data_reason: 'unsupported' } as FilterErrorResult)
    }

    await ackMessage(runtime.sqsClient, runtime.config.inputQueueUrl, receiptHandle)
  } catch (error) {
    if (error instanceof MissingObjectError) {
      await ackMessage(runtime.sqsClient, runtime.config.inputQueueUrl, receiptHandle)
      return
    }

    if (error instanceof FatalS3AccessError) {
      throw error
    }

    if (error instanceof RetryableJobError) {
      await releaseMessage(runtime.sqsClient, runtime.config.inputQueueUrl, receiptHandle)
      return
    }

    await slackLog('classifier-host', txid, 'message worker error', (error as Error).name, (error as Error).message)
    await releaseMessage(runtime.sqsClient, runtime.config.inputQueueUrl, receiptHandle)
  } finally {
    releaseVideoBytes(state, reservedVideoBytes)
    state.activeTxids.delete(txid)
  }
}

export const startSqsConsumer = async (runtime: ClassifierHostRuntime): Promise<never> => {
  const activeWorkers = new Set<Promise<void>>()
  const state: WorkerState = {
    activeTxids: new Set<string>(),
    activeVideoBytes: 0,
  }

  let fatalError: Error | undefined
  while (true) {
    try {
      while (activeWorkers.size >= runtime.config.maxConcurrent) {
        await Promise.race(activeWorkers)
        if (fatalError) throw fatalError
      }

      const availableSlots = Math.max(1, runtime.config.maxConcurrent - activeWorkers.size)
      const response = await runtime.sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: runtime.config.inputQueueUrl,
        MaxNumberOfMessages: Math.min(availableSlots, 10),
        WaitTimeSeconds: runtime.config.waitTimeSeconds,
        VisibilityTimeout: runtime.config.visibilityTimeoutSeconds,
        MessageAttributeNames: ['All'],
      }))

      if (response.Messages?.length) {
        for (const message of response.Messages) {
          let workerPromise: Promise<void>
          workerPromise = processMessageWorker(runtime, message, state)
            .catch(error => {
              if (error instanceof FatalS3AccessError) {
                fatalError = error
              } else {
                console.error('classifier-host', 'worker failed', (error as Error).name, (error as Error).message)
              }
            })
            .finally(() => {
              activeWorkers.delete(workerPromise)
            })
          activeWorkers.add(workerPromise)
        }
      }

      if (fatalError) {
        throw fatalError
      }
    } catch (error) {
      if (error instanceof FatalS3AccessError) {
        await slackLog('classifier-host', 'fatal', error.message)
        throw error
      }

      await slackLog('classifier-host', 'poll-error', (error as Error).name, (error as Error).message)
      await sleep(5000)
    }
  }
}

