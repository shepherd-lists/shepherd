import { Message, SQSClient } from '@aws-sdk/client-sqs'
import { S3EventRecord } from 'aws-lambda'
import { FilterErrorResult, FilterPluginInterface, FilterResult } from 'shepherd-plugin-interfaces'

export type PluginResult = FilterResult | FilterErrorResult
export type PartialPluginResult = Partial<FilterResult> & Partial<FilterErrorResult>

export interface IncomingExtra {
  addonName: string
  filterResult: PartialPluginResult
}

export interface ParsedS3QueueMessage {
  txid: string
  receiptHandle: string
  incomingExtra?: IncomingExtra
}

export interface HeadObjectInfo {
  contentType: string
  contentLength: number
}

export interface ClassifierHostConfig {
  addonName: string
  inputBucket: string
  inputQueueUrl: string
  outputQueueUrl: string
  sinkQueueUrl: string
  maxConcurrent: number
  waitTimeSeconds: number
  visibilityTimeoutSeconds: number
  videoConcurrency: number
  tmpDir: string
}

export interface ClassifierHostRuntime {
  config: ClassifierHostConfig
  plugin: FilterPluginInterface
  sqsClient: SQSClient
}

export interface MessageWorkerContext extends ClassifierHostRuntime {
  message: Message
}

export interface S3EventLike {
  Records: S3EventRecord[]
  extra?: IncomingExtra
}

export class RetryableJobError extends Error {
  constructor(message: string, public readonly txid: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'RetryableJobError'
  }
}

