import { Message, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { FilterErrorResult, FilterPluginInterface } from 'shepherd-plugin-interfaces'
import pLimit, { LimitFunction } from 'p-limit'
import { slackLog } from '../utils/slackLog'
import { sqsClient } from '../utils/sqs-client'
import {
  INPUT_QUEUE_URL,
  OUTPUT_QUEUE_URL,
  SINK_QUEUE_URL,
  NUM_FILES,
  VIDEO_CONCURRENCY,
  WAIT_TIME_SECONDS,
  VISIBILITY_TIMEOUT_SECONDS,
} from '../constants'
import { emitClassifierResult } from '../3-output/emit-result'
import { setIncomingExtra, deleteIncomingExtra } from './incoming-extra'
import { ackMessage, releaseMessage, startVisibilityHeartbeat } from './message-lifecycle'
import { processImage } from '../2-processing/process-image'
import { processVideo } from '../2-processing/process-video'
import { processGif } from '../2-processing/process-gif'
import { FatalS3AccessError, MissingObjectError, s3HeadObject } from './s3-read'
import { ParsedS3QueueMessage, RetryableJobError, S3EventLike } from '../types'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** last path segment of an SQS URL, for readable logs */
const queueShortName = (queueUrl: string) => queueUrl.split('/').filter(Boolean).pop() ?? queueUrl

export const parseMessage = (message: Message): ParsedS3QueueMessage => {
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
  videoLimit: LimitFunction
}

const processMessageWorker = async (
  plugin: FilterPluginInterface,
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
      await ackMessage(receipt)
    }
    return
  }

  const { txid, receiptHandle, incomingExtra } = parsed
  if (state.activeTxids.has(txid)) {
    console.info(txid, 'release: already in-flight')
    await releaseMessage(receiptHandle)
    return
  }

  state.activeTxids.add(txid)
  const startedAt = Date.now()
  console.info(txid, 'handler start')

  /* keep the message invisible while it waits for a video slot and/or processes */
  const stopHeartbeat = startVisibilityHeartbeat(receiptHandle)

  try {
    setIncomingExtra(txid, incomingExtra)

    const head = await s3HeadObject(txid)
    const contentType = head.contentType || 'application/octet-stream'
    const isGif = contentType === 'image/gif'
    const isImage = contentType.startsWith('image/')
    const isVideo = contentType.startsWith('video/')
    console.info(txid, 'head', contentType, head.contentLength, 'bytes')

    /* GIFs and videos share the same ffmpeg-bound slot: excess wait here in-process rather than
     * bouncing to SQS. GIF is checked before isImage since a GIF is also image/*. */
    const runBounded = (label: string, fn: () => Promise<void>) => {
      console.info(txid, `${label} queued`, `running=${state.videoLimit.activeCount} waiting=${state.videoLimit.pendingCount}`)
      return state.videoLimit(() => {
        console.info(txid, `${label} dequeued`, `running=${state.videoLimit.activeCount} waiting=${state.videoLimit.pendingCount}`)
        return fn()
      })
    }

    if (isGif) {
      await runBounded('gif', () => processGif(plugin, txid))
    } else if (isImage) {
      await processImage(plugin, txid, contentType)
    } else if (isVideo) {
      await runBounded('video', () => processVideo(plugin, txid))
    } else {
      await emitClassifierResult(txid, { flagged: undefined, data_reason: 'mimetype' } as FilterErrorResult)
    }

    console.info(txid, 'ack message...')
    await ackMessage(receiptHandle)
  } catch (error) {
    if (error instanceof MissingObjectError) {
      console.info(txid, 'ack message: object missing...')
      await ackMessage(receiptHandle)
      return
    }

    if (error instanceof FatalS3AccessError) {
      throw error
    }

    if (error instanceof RetryableJobError) {
      console.info(txid, 'release message: retryable...', (error as Error).message)
      await releaseMessage(receiptHandle)
      return
    }

    await slackLog('[classifier-host]', txid, 'releasing message: worker error', (error as Error).name, (error as Error).message)
    await releaseMessage(receiptHandle)
  } finally {
    stopHeartbeat()
    deleteIncomingExtra(txid)
    state.activeTxids.delete(txid)
    console.info(txid, 'handler finish', `${Date.now() - startedAt}ms`)
  }
}

export const startSqsConsumer = async (plugin: FilterPluginInterface): Promise<never> => {
  const activeWorkers = new Set<Promise<void>>()
  const state: WorkerState = {
    activeTxids: new Set<string>(),
    videoLimit: pLimit(VIDEO_CONCURRENCY),
  }

  console.info('consumer start',
    'input=' + queueShortName(INPUT_QUEUE_URL),
    'output=' + queueShortName(OUTPUT_QUEUE_URL),
    'sink=' + queueShortName(SINK_QUEUE_URL),
    'numFiles=' + NUM_FILES,
  )

  /* periodic snapshot of the in-process video backlog (videos stuck waiting for a pLimit slot) */
  setInterval(() => {
    console.info('videos', `running=${state.videoLimit.activeCount} waiting=${state.videoLimit.pendingCount}`)
  }, 15_000).unref()

  let fatalError: Error | undefined
  while (true) {
    try {
      while (activeWorkers.size >= NUM_FILES) {
        await Promise.race(activeWorkers)
        if (fatalError) throw fatalError
      }

      const availableSlots = Math.max(1, NUM_FILES - activeWorkers.size)
      const response = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: INPUT_QUEUE_URL,
        MaxNumberOfMessages: Math.min(availableSlots, 10),
        WaitTimeSeconds: WAIT_TIME_SECONDS,
        VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
        MessageAttributeNames: ['All'],
      }))

      console.info('received', response.Messages?.length ?? 0, 'message(s)')
      if (response.Messages?.length) {
        for (const message of response.Messages) {
          let workerPromise: Promise<void>
          workerPromise = processMessageWorker(plugin, message, state)
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
