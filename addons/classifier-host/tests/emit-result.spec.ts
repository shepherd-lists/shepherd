import assert from 'node:assert/strict'
import { mock, test, beforeEach } from 'node:test'
import type { PartialPluginResult, PluginResult } from '../src/types'
import './_import-test-env-vars'

/* emit-result reads queue/bucket/addon from ../src/constants at module load, so env must be set
 * (above) before importing it or the shared SQS client. */
const { emitClassifierResult, queueForResult } = await import('../src/3-output/emit-result')
const { setIncomingExtra, getAndDeleteIncomingExtra } = await import('../src/1-incoming/incoming-extra')
const { sqsClient } = await import('../src/utils/sqs-client')
const { OUTPUT_QUEUE_URL, SINK_QUEUE_URL, INPUT_BUCKET, ADDON_NAME } = await import('../src/constants')

interface SentMessage { QueueUrl: string; MessageBody: string }

/** spy on the shared SQS client; returns the captured sends */
const spySqs = (impl?: () => Promise<{ MessageId: string }>) => {
  const sent: SentMessage[] = []
  mock.method(sqsClient, 'send', async (command: { input: SentMessage }) => {
    sent.push({ QueueUrl: command.input.QueueUrl, MessageBody: command.input.MessageBody })
    return impl ? impl() : { MessageId: `msg-${sent.length}` }
  })
  return sent
}

beforeEach(() => mock.restoreAll())

/* ---- routing ---- */

test('routes a flagged result to the output (next classifier) queue', async () => {
  const sent = spySqs()
  await emitClassifierResult('txid-flag', { flagged: true, top_score_name: 'nsfw', top_score_value: 0.9 } as PluginResult)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].QueueUrl, OUTPUT_QUEUE_URL)
})

test('routes a clean result straight to the sink (final) queue, bypassing the chain', async () => {
  const sent = spySqs()
  await emitClassifierResult('txid-clean', { flagged: false } as PluginResult)
  assert.equal(sent[0].QueueUrl, SINK_QUEUE_URL)
})

for (const data_reason of ['corrupt-maybe', 'partial', 'oversized', 'unsupported'] as const) {
  test(`forwards uncertain '${data_reason}' to the next classifier (output queue)`, async () => {
    const sent = spySqs()
    await emitClassifierResult(`txid-${data_reason}`, { flagged: undefined, data_reason } as PluginResult)
    assert.equal(sent[0].QueueUrl, OUTPUT_QUEUE_URL)
  })
}

for (const data_reason of ['corrupt', 'noop', 'retry', 'mimetype'] as const) {
  test(`routes terminal '${data_reason}' to the sink queue`, async () => {
    const sent = spySqs()
    await emitClassifierResult(`txid-${data_reason}`, { flagged: undefined, data_reason } as PluginResult)
    assert.equal(sent[0].QueueUrl, SINK_QUEUE_URL)
  })
}

test('when output===sink (last classifier) an uncertain result still goes to the sink', () => {
  const final = 'https://sqs/final-q'
  const result = { flagged: undefined, data_reason: 'unsupported' } as PartialPluginResult
  const queueUrl = queueForResult(result, final, final)
  assert.equal(queueUrl, final)
})

/* ---- merge ("latest wins", score preserved) ---- */

test('carries a higher previous score onto a clean result but keeps the clean verdict', async () => {
  const sent = spySqs()
  setIncomingExtra('txid-m1', { addonName: 'prev', filterResult: { flagged: true, top_score_name: 'nsfw', top_score_value: 0.95 } as PartialPluginResult })
  await emitClassifierResult('txid-m1', { flagged: false, top_score_name: 'clean', top_score_value: 0.1 } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.extra.filterResult.flagged, false)        // latest wins
  assert.equal(body.extra.filterResult.top_score_name, 'nsfw') // higher score preserved
  assert.equal(body.extra.filterResult.top_score_value, 0.95)
  assert.equal(sent[0].QueueUrl, SINK_QUEUE_URL)              // clean -> sink
})

test('keeps the current score when it is higher than the previous', async () => {
  const sent = spySqs()
  setIncomingExtra('txid-m2', { addonName: 'prev', filterResult: { flagged: false, top_score_name: 'prev', top_score_value: 0.2 } as PartialPluginResult })
  await emitClassifierResult('txid-m2', { flagged: false, top_score_name: 'cur', top_score_value: 0.5 } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.extra.filterResult.top_score_name, 'cur')
  assert.equal(body.extra.filterResult.top_score_value, 0.5)
})

test('does not merge a previous score when the current result is flagged', async () => {
  const sent = spySqs()
  setIncomingExtra('txid-m3', { addonName: 'prev', filterResult: { flagged: false, top_score_name: 'prev', top_score_value: 0.9 } as PartialPluginResult })
  await emitClassifierResult('txid-m3', { flagged: true, top_score_name: 'cur', top_score_value: 0.3 } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.extra.filterResult.flagged, true)
  assert.equal(body.extra.filterResult.top_score_name, 'cur')
})

test('does not resurrect a previous flag when the current result is an error', async () => {
  const sent = spySqs()
  setIncomingExtra('txid-m4', { addonName: 'prev', filterResult: { flagged: true, top_score_name: 'nsfw', top_score_value: 0.9 } as PartialPluginResult })
  await emitClassifierResult('txid-m4', { flagged: undefined, data_reason: 'unsupported' } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.extra.filterResult.flagged, undefined)
  assert.equal(body.extra.filterResult.data_reason, 'unsupported')
  assert.equal(body.extra.filterResult.top_score_name, undefined)
})

/* ---- incoming-extra lifecycle ---- */

test('consumes the incoming extra so nothing is left in the map', async () => {
  spySqs()
  setIncomingExtra('txid-consume', { addonName: 'prev', filterResult: { flagged: false } as PartialPluginResult })
  await emitClassifierResult('txid-consume', { flagged: false } as PluginResult)
  assert.equal(getAndDeleteIncomingExtra('txid-consume'), undefined)
})

/* ---- retries & payload ---- */

test('retries a failed SQS send and succeeds within 3 attempts', async () => {
  let attempts = 0
  mock.method(sqsClient, 'send', async () => {
    attempts++
    if (attempts < 2) throw new Error('transient')
    return { MessageId: 'ok' }
  })
  const id = await emitClassifierResult('txid-retry', { flagged: false } as PluginResult)
  assert.equal(attempts, 2)
  assert.equal(id, 'ok')
})

test('throws after 3 failed SQS send attempts', async () => {
  let attempts = 0
  mock.method(sqsClient, 'send', async () => { attempts++; throw new Error('always fails') })
  await assert.rejects(() => emitClassifierResult('txid-fail', { flagged: false } as PluginResult), /always fails/)
  assert.equal(attempts, 3)
})

test('builds an S3 event payload keyed by txid with the addon name', async () => {
  const sent = spySqs()
  await emitClassifierResult('txid-shape', { flagged: false } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.Records[0].s3.object.key, 'txid-shape')
  assert.equal(body.Records[0].s3.bucket.name, INPUT_BUCKET)
  assert.equal(body.extra.addonName, ADDON_NAME)
})
