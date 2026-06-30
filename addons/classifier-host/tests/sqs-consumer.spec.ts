import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Message } from '@aws-sdk/client-sqs'
import './_import-test-env-vars'

/* sqs-consumer pulls in constants/s3-read, which throw at module load unless the required env vars
 * are set (above), so set them then dynamic-import the module under test. */
const { parseMessage } = await import('../src/1-incoming/sqs-consumer')

const s3EventBody = (key: string, extra?: unknown) => JSON.stringify({
  Records: [{ s3: { object: { key } } }],
  ...(extra ? { extra } : {}),
})

describe('parseMessage', () => {
  test('extracts txid, receiptHandle and incomingExtra', () => {
    const extra = { addonName: 'prev', filterResult: { flagged: false } }
    const parsed = parseMessage({ Body: s3EventBody('mytxid', extra), ReceiptHandle: 'rh', MessageId: 'm1' } as Message)
    assert.equal(parsed.txid, 'mytxid')
    assert.equal(parsed.receiptHandle, 'rh')
    assert.deepEqual(parsed.incomingExtra, extra)
  })

  test('throws when Body or ReceiptHandle is missing', () => {
    assert.throws(() => parseMessage({ ReceiptHandle: 'rh' } as Message), /missing Body or ReceiptHandle/)
    assert.throws(() => parseMessage({ Body: s3EventBody('x') } as Message), /missing Body or ReceiptHandle/)
  })

  test('throws when the S3 object key (txid) is missing', () => {
    const body = JSON.stringify({ Records: [{ s3: { object: {} } }] })
    assert.throws(() => parseMessage({ Body: body, ReceiptHandle: 'rh', MessageId: 'm' } as Message), /missing txid/)
  })
})
