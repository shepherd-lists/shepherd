import { S3EventRecord } from 'aws-lambda'
import { FilterErrorResult, FilterResult } from 'shepherd-plugin-interfaces'

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

