import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FfmpegProcessingError, ffmpegErrorText, isRetryableFfmpegError } from '../src/2-processing/extract-frames'

describe('isRetryableFfmpegError', () => {
  test('out-of-memory is retryable', () => {
    assert.equal(isRetryableFfmpegError(new Error('spawnSync /bin/sh ENOMEM')), true)
  })

  test('known non-retryable signatures are not retryable', () => {
    const signatures = [
      'Output file does not contain any stream',     // ffmpeg 8.x phrasing
      'Output file #0 does not contain any stream',  // ffmpeg 5.x phrasing
      'Invalid data found when processing input',
      'No such file or directory',
      'Conversion failed!',
      'Error opening filters!',
      'Error marking filters as finished',
    ]
    for (const msg of signatures) {
      assert.equal(isRetryableFfmpegError(new Error(msg)), false, msg)
    }
  })

  test('genuinely unknown errors default to retryable', () => {
    assert.equal(isRetryableFfmpegError(new Error('some brand new ffmpeg failure')), true)
  })

  test('matches a signature buried in the full stderr, not just the last line', () => {
    /* real ffmpeg: the useful line is first, the last line is generic — last-line-only would misread this */
    const stderr = [
      '[out#0/image2 @ 0x1] Output file does not contain any stream',
      'Error opening output file frame-%06d.png.',
      'Error opening output files: Invalid argument',
    ].join('\n')
    const err = new FfmpegProcessingError('Error opening output files: Invalid argument', stderr)
    assert.equal(isRetryableFfmpegError(err), false)
  })
})

describe('ffmpegErrorText', () => {
  test('combines the parsed message and the raw stderr', () => {
    const err = new FfmpegProcessingError('last-line', 'first-line\nlast-line')
    const text = ffmpegErrorText(err)
    assert.ok(text.includes('first-line'))
    assert.ok(text.includes('last-line'))
  })

  test('falls back to .message for non-ffmpeg errors', () => {
    assert.equal(ffmpegErrorText(new Error('plain error')), 'plain error')
  })
})
