import { mkdir, rm } from 'node:fs/promises'
import { FilterErrorResult, FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { emitClassifierResult } from '../3-output/emit-result'
import { extractKeyframes, ffmpegErrorText, isRetryableFfmpegError, NO_FRAMES_EXTRACTED } from './extract-frames'
import { classifyFrames } from './classify'
import { FatalS3AccessError, MissingObjectError, s3DownloadToFile } from '../1-incoming/s3-read'
import { resultSummary } from '../utils/log-result-summary'
import { TMP_DIR } from '../constants'
import { RetryableJobError } from '../types'
import { slackLog } from '../utils/slackLog'

const CORRUPT_MAYBE_MESSAGES = [
  'Invalid data found when processing input',
  'Error opening filters!',
  'Conversion failed!',
  'Error marking filters as finished',
]

export const mapVideoErrorResult = (error: unknown): FilterErrorResult => {
  const text = ffmpegErrorText(error)
  const err_message = (error as Error).message ?? 'some video processing error'

  if (text.includes('does not contain any stream')) {
    return { flagged: undefined, data_reason: 'corrupt', err_message }
  }

  if (CORRUPT_MAYBE_MESSAGES.some(entry => text.includes(entry))) {
    return { flagged: undefined, data_reason: 'corrupt-maybe' }
  }

  if (text.includes(NO_FRAMES_EXTRACTED)) {
    return { flagged: undefined, data_reason: 'no-frames-extracted' as FilterErrorResult['data_reason'] }
  }

  return { flagged: undefined, data_reason: err_message as FilterErrorResult['data_reason'] }
}

export const isRetryableVideoError = (error: unknown) => {
  const text = ffmpegErrorText(error)
  if (text.includes('ENOMEM') || text.includes('ECONNRESET')) return true
  return isRetryableFfmpegError(error)
}

/**
 * Wipe the video temp dir once at startup. The per-job `finally` below only runs on normal
 * completion, so a crash/OOM/SIGKILL mid-extraction orphans a workdir; with `restart: unless-stopped`
 * the container reuses the same filesystem and those orphans would accumulate until the disk fills.
 */
export const resetVideoTempDir = async () => {
  if (!TMP_DIR) return
  await rm(TMP_DIR, { recursive: true, force: true })
  await mkdir(TMP_DIR, { recursive: true })
}

type FrameExtractor = (inputPath: string, outputDir: string) => Promise<string[]>

/**
 * Download a txid to a temp workdir, extract its frames via `extractFrames`, classify them, and emit
 * the result — cleaning up the workdir afterwards. Shared by video and GIF processing; only the
 * extractor (keyframes vs every GIF frame) and the `label` in logs differ. The ffmpeg error mapping
 * (`mapVideoErrorResult`/`isRetryableVideoError`) is generic and applies to both.
 */
export const processFileToFrames = async (
  plugin: FilterPluginInterface,
  txid: string,
  extractFrames: FrameExtractor,
  label: string,
) => {
  const txidTempDir = TMP_DIR + txid
  await mkdir(txidTempDir, { recursive: true })

  try {
    console.info(txid, `${label} classify start`)
    await s3DownloadToFile(txid, `${txidTempDir}/${txid}`)
    console.info(txid, `${label} downloaded`)
    const framePaths = await extractFrames(`${txidTempDir}/${txid}`, txidTempDir)
    console.info(txid, `${label} frames extracted`, framePaths.length)
    const filterResult = await classifyFrames(plugin, framePaths, txidTempDir, txid)
    console.info(txid, `${label} classify result`, resultSummary(filterResult))
    await emitClassifierResult(txid, filterResult)
  } catch (error) {
    if (error instanceof MissingObjectError || error instanceof FatalS3AccessError) {
      throw error
    }

    if (isRetryableVideoError(error)) {
      throw new RetryableJobError(`Retryable ${label} error for ${txid}: ${(error as Error).message}`, txid, error)
    }

    const errFilterResult = mapVideoErrorResult(error)
    console.info(txid, `${label} classify error -> routing`, errFilterResult.data_reason, (error as Error).message)

    if (error instanceof Error && error.message === NO_FRAMES_EXTRACTED) {
      await slackLog('process-video', txid, `${label} no frames extracted`)
    }
    await emitClassifierResult(txid, errFilterResult)
  } finally {
    await rm(txidTempDir, { recursive: true, force: true })
  }
}

export const processVideo = async (
  plugin: FilterPluginInterface,
  txid: string,
) => processFileToFrames(plugin, txid, extractKeyframes, 'video')

