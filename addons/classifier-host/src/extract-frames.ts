import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const NON_RETRYABLE_FFMPEG_ERRORS = [
  'Output file #0 does not contain any stream',
  'Invalid data found when processing input',
  'No such file or directory',
  'Conversion failed!',
  'Error opening filters!',
  'Error marking filters as finished',
]

export class FfmpegProcessingError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message)
    this.name = 'FfmpegProcessingError'
  }
}

const parseFfmpegErrorMessage = (stderr: string) => {
  const trimmed = stderr.trim()
  if (!trimmed) return 'ffmpeg failed'
  const lines = trimmed.split('\n').map(line => line.trim()).filter(Boolean)
  const relevant = lines[lines.length - 1] ?? trimmed
  return relevant
}

export const isRetryableFfmpegError = (error: unknown) => {
  const message = (error as Error).message ?? ''
  if (message.includes('ENOMEM')) return true
  return !NON_RETRYABLE_FFMPEG_ERRORS.some(item => message.includes(item))
}

export const extractKeyframes = async (
  ffmpegPath: string,
  videoPath: string,
  outputDir: string,
): Promise<string[]> => {
  const outputPattern = path.join(outputDir, 'frame-%06d.png')
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-skip_frame',
    'nokey',
    '-i',
    videoPath,
    '-vsync',
    'vfr',
    '-frame_pts',
    '1',
    outputPattern,
  ]

  const stderrChunks: string[] = []
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })

    child.stderr.on('data', chunk => {
      stderrChunks.push(chunk.toString())
    })

    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
        return
      }
      const stderr = stderrChunks.join('')
      reject(new FfmpegProcessingError(parseFfmpegErrorMessage(stderr), stderr))
    })
  })

  const files = await readdir(outputDir)
  const frames = files
    .filter(file => file.startsWith('frame-') && file.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b))
    .map(file => path.join(outputDir, file))

  if (frames.length === 0) {
    throw new FfmpegProcessingError('Output file #0 does not contain any stream', '')
  }

  return frames
}

