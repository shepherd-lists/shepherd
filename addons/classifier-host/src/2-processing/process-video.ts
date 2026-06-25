import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FilterErrorResult, FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { emitClassifierResult, EmitResultContext } from '../3-output/emit-result'
import { extractKeyframes, ffmpegErrorText, isRetryableFfmpegError } from './extract-frames'
import { classifyFrames } from './classify'
import { FatalS3AccessError, MissingObjectError, s3DownloadToFile } from '../1-incoming/s3-read'
import { resultSummary } from '../utils/log-result-summary'
import { RetryableJobError } from '../types'

const CORRUPT_MAYBE_MESSAGES = [
  'Invalid data found when processing input',
  'Error opening filters!',
  'Conversion failed!',
  'Error marking filters as finished',
]

export const mapVideoErrorResult = (error: unknown): FilterErrorResult => {
  const text = ffmpegErrorText(error)
  const err_message = (error as Error).message ?? 'video processing error'

  if (text.includes('does not contain any stream')) {
    return { flagged: undefined, data_reason: 'corrupt', err_message }
  }

  if (CORRUPT_MAYBE_MESSAGES.some(entry => text.includes(entry))) {
    return { flagged: undefined, data_reason: 'corrupt-maybe', err_message }
  }

  return { flagged: undefined, data_reason: 'corrupt-maybe', err_message }
}

export const isRetryableVideoError = (error: unknown) => {
  const text = ffmpegErrorText(error)
  if (text.includes('ENOMEM') || text.includes('ECONNRESET')) return true
  return isRetryableFfmpegError(error)
}

export interface ProcessVideoContext extends EmitResultContext {
  plugin: FilterPluginInterface
  txid: string
  ffmpegPath: string
  tmpRootDir: string
}

export const processVideo = async (context: ProcessVideoContext) => {
  const tmpParentDir = context.tmpRootDir || os.tmpdir()
  await mkdir(tmpParentDir, { recursive: true })
  const tmpPrefix = path.join(tmpParentDir, `${context.txid}-`)
  const workDir = await mkdtemp(tmpPrefix)
  const videoPath = path.join(workDir, context.txid)

  try {
    console.info(context.txid, 'video classify start')
    await s3DownloadToFile(context.txid, videoPath)
    const framePaths = await extractKeyframes(context.ffmpegPath, videoPath, workDir)
    console.info(context.txid, 'video frames extracted', framePaths.length)
    const filterResult = await classifyFrames(context.plugin, framePaths, context.txid)
    console.info(context.txid, 'video classify result', resultSummary(filterResult))
    await emitClassifierResult(context, context.txid, filterResult)
  } catch (error) {
    if (error instanceof MissingObjectError || error instanceof FatalS3AccessError) {
      throw error
    }

    if (isRetryableVideoError(error)) {
      throw new RetryableJobError(`Retryable video error for ${context.txid}: ${(error as Error).message}`, context.txid, error)
    }

    const filterResult = mapVideoErrorResult(error)
    console.info(context.txid, 'video classify error -> routing', filterResult.data_reason, (error as Error).message)
    await emitClassifierResult(context, context.txid, filterResult)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

