import assert from 'node:assert/strict'
import { test } from 'node:test'
import './_import-test-env-vars'

/* process-video imports constants/s3-read, which throw at module load unless the required env vars
 * are set (above), so set them then dynamic-import the module under test. */
const { mapVideoErrorResult, isRetryableVideoError } = await import('../src/2-processing/process-video')
const { FfmpegProcessingError } = await import('../src/2-processing/extract-frames')

test('mapVideoErrorResult: no-stream maps to corrupt (with or without the "#0")', () => {
  for (const msg of ['Output file does not contain any stream', 'Output file #0 does not contain any stream']) {
    assert.equal(mapVideoErrorResult(new Error(msg)).data_reason, 'corrupt', msg)
  }
})

test('mapVideoErrorResult: known signatures map to corrupt-maybe', () => {
  const signatures = [
    'Invalid data found when processing input',
    'Error opening filters!',
    'Conversion failed!',
    'Error marking filters as finished',
  ]
  for (const msg of signatures) {
    assert.equal(mapVideoErrorResult(new Error(msg)).data_reason, 'corrupt-maybe', msg)
  }
})

test('mapVideoErrorResult: unknown errors map to corrupt-maybe', () => {
  assert.equal(mapVideoErrorResult(new Error('mystery failure')).data_reason, 'corrupt-maybe')
})

test('mapVideoErrorResult reads the full stderr when the signature is not on the last line', () => {
  const stderr = [
    '[out#0] Output file does not contain any stream',
    'Error opening output files: Invalid argument',
  ].join('\n')
  const err = new FfmpegProcessingError('Error opening output files: Invalid argument', stderr)
  assert.equal(mapVideoErrorResult(err).data_reason, 'corrupt')
})

test('isRetryableVideoError: ENOMEM/ECONNRESET retryable; corrupt signatures not', () => {
  assert.equal(isRetryableVideoError(new Error('spawnSync /bin/sh ENOMEM')), true)
  assert.equal(isRetryableVideoError(new Error('socket hang up ECONNRESET')), true)
  assert.equal(isRetryableVideoError(new Error('Invalid data found when processing input')), false)
  assert.equal(isRetryableVideoError(new Error('Output file does not contain any stream')), false)
})
