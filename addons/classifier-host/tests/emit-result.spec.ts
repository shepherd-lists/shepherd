import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emitClassifierResult, EmitResultContext } from '../src/3-output/emit-result'
import { setIncomingExtra, getAndDeleteIncomingExtra } from '../src/1-incoming/incoming-extra'
import { PluginResult } from '../src/types'

interface SentMessage { QueueUrl: string; MessageBody: string }

const makeContext = (overrides: Partial<EmitResultContext> = {}) => {
  const sent: SentMessage[] = []
  const sqsClient = {
    send: async (command: { input: SentMessage }) => {
      sent.push({ QueueUrl: command.input.QueueUrl, MessageBody: command.input.MessageBody })
      return { MessageId: `msg-${sent.length}` }
    },
  }
  const context: EmitResultContext = {
    sqsClient: sqsClient as unknown as EmitResultContext['sqsClient'],
    inputBucket: 'test-bucket',
    outputQueueUrl: 'https://sqs/output-q',
    sinkQueueUrl: 'https://sqs/sink-q',
    addonName: 'test-addon',
    ...overrides,
  }
  return { context, sent }
}

/* ---- routing ---- */

test('routes a flagged result to the output (next classifier) queue', async () => {
  const { context, sent } = makeContext()
  await emitClassifierResult(context, 'txid-flag', { flagged: true, top_score_name: 'nsfw', top_score_value: 0.9 } as PluginResult)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].QueueUrl, context.outputQueueUrl)
})

test('routes a clean result straight to the sink (final) queue, bypassing the chain', async () => {
  const { context, sent } = makeContext()
  await emitClassifierResult(context, 'txid-clean', { flagged: false } as PluginResult)
  assert.equal(sent[0].QueueUrl, context.sinkQueueUrl)
})

for (const data_reason of ['corrupt-maybe', 'partial', 'oversized', 'unsupported'] as const) {
  test(`forwards uncertain '${data_reason}' to the next classifier (output queue)`, async () => {
    const { context, sent } = makeContext()
    await emitClassifierResult(context, `txid-${data_reason}`, { flagged: undefined, data_reason } as PluginResult)
    assert.equal(sent[0].QueueUrl, context.outputQueueUrl)
  })
}

for (const data_reason of ['corrupt', 'noop', 'retry', 'mimetype'] as const) {
  test(`routes terminal '${data_reason}' to the sink queue`, async () => {
    const { context, sent } = makeContext()
    await emitClassifierResult(context, `txid-${data_reason}`, { flagged: undefined, data_reason } as PluginResult)
    assert.equal(sent[0].QueueUrl, context.sinkQueueUrl)
  })
}

test('when output===sink (last classifier) an uncertain result still goes to the sink', async () => {
  const final = 'https://sqs/final-q'
  const { context, sent } = makeContext({ outputQueueUrl: final, sinkQueueUrl: final })
  await emitClassifierResult(context, 'txid-last', { flagged: undefined, data_reason: 'unsupported' } as PluginResult)
  assert.equal(sent[0].QueueUrl, final)
})

/* ---- merge ("latest wins", score preserved) ---- */

test('carries a higher previous score onto a clean result but keeps the clean verdict', async () => {
  const { context, sent } = makeContext()
  setIncomingExtra('txid-m1', { addonName: 'prev', filterResult: { flagged: true, top_score_name: 'nsfw', top_score_value: 0.95 } })
  await emitClassifierResult(context, 'txid-m1', { flagged: false, top_score_name: 'clean', top_score_value: 0.1 } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.extra.filterResult.flagged, false)        // latest wins
  assert.equal(body.extra.filterResult.top_score_name, 'nsfw') // higher score preserved
  assert.equal(body.extra.filterResult.top_score_value, 0.95)
  assert.equal(sent[0].QueueUrl, context.sinkQueueUrl)         // clean → sink
})

test('keeps the current score when it is higher than the previous', async () => {
  const { context, sent } = makeContext()
  setIncomingExtra('txid-m2', { addonName: 'prev', filterResult: { flagged: false, top_score_name: 'prev', top_score_value: 0.2 } })
  await emitClassifierResult(context, 'txid-m2', { flagged: false, top_score_name: 'cur', top_score_value: 0.5 } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.extra.filterResult.top_score_name, 'cur')
  assert.equal(body.extra.filterResult.top_score_value, 0.5)
})

test('does not merge a previous score when the current result is flagged', async () => {
  const { context, sent } = makeContext()
  setIncomingExtra('txid-m3', { addonName: 'prev', filterResult: { flagged: false, top_score_name: 'prev', top_score_value: 0.9 } })
  await emitClassifierResult(context, 'txid-m3', { flagged: true, top_score_name: 'cur', top_score_value: 0.3 } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.extra.filterResult.flagged, true)
  assert.equal(body.extra.filterResult.top_score_name, 'cur')
})

test('does not resurrect a previous flag when the current result is an error', async () => {
  const { context, sent } = makeContext()
  setIncomingExtra('txid-m4', { addonName: 'prev', filterResult: { flagged: true, top_score_name: 'nsfw', top_score_value: 0.9 } })
  await emitClassifierResult(context, 'txid-m4', { flagged: undefined, data_reason: 'unsupported' } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.extra.filterResult.flagged, undefined)
  assert.equal(body.extra.filterResult.data_reason, 'unsupported')
  assert.equal(body.extra.filterResult.top_score_name, undefined)
})

/* ---- incoming-extra lifecycle ---- */

test('consumes the incoming extra so nothing is left in the map', async () => {
  const { context } = makeContext()
  setIncomingExtra('txid-consume', { addonName: 'prev', filterResult: { flagged: false } })
  await emitClassifierResult(context, 'txid-consume', { flagged: false } as PluginResult)
  assert.equal(getAndDeleteIncomingExtra('txid-consume'), undefined)
})

/* ---- retries & payload ---- */

test('retries a failed SQS send and succeeds within 3 attempts', async () => {
  let attempts = 0
  const sqsClient = {
    send: async () => {
      attempts++
      if (attempts < 2) throw new Error('transient')
      return { MessageId: 'ok' }
    },
  }
  const context: EmitResultContext = {
    sqsClient: sqsClient as unknown as EmitResultContext['sqsClient'],
    inputBucket: 'b', outputQueueUrl: 'o', sinkQueueUrl: 's', addonName: 'a',
  }
  const id = await emitClassifierResult(context, 'txid-retry', { flagged: false } as PluginResult)
  assert.equal(attempts, 2)
  assert.equal(id, 'ok')
})

test('throws after 3 failed SQS send attempts', async () => {
  let attempts = 0
  const sqsClient = { send: async () => { attempts++; throw new Error('always fails') } }
  const context: EmitResultContext = {
    sqsClient: sqsClient as unknown as EmitResultContext['sqsClient'],
    inputBucket: 'b', outputQueueUrl: 'o', sinkQueueUrl: 's', addonName: 'a',
  }
  await assert.rejects(() => emitClassifierResult(context, 'txid-fail', { flagged: false } as PluginResult), /always fails/)
  assert.equal(attempts, 3)
})

test('builds an S3 event payload keyed by txid with the addon name', async () => {
  const { context, sent } = makeContext()
  await emitClassifierResult(context, 'txid-shape', { flagged: false } as PluginResult)
  const body = JSON.parse(sent[0].MessageBody)
  assert.equal(body.Records[0].s3.object.key, 'txid-shape')
  assert.equal(body.Records[0].s3.bucket.name, 'test-bucket')
  assert.equal(body.extra.addonName, 'test-addon')
})
