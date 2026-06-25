import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setIncomingExtra, getAndDeleteIncomingExtra, deleteIncomingExtra } from '../src/1-incoming/incoming-extra'
import { PartialPluginResult } from '../src/types'

test('set then getAndDelete returns the entry once and removes it', () => {
  setIncomingExtra('t1', { addonName: 'a', filterResult: { flagged: false } as PartialPluginResult })
  assert.equal(getAndDeleteIncomingExtra('t1')?.addonName, 'a')
  assert.equal(getAndDeleteIncomingExtra('t1'), undefined)
})

test('set(undefined) is a no-op', () => {
  setIncomingExtra('t2', undefined)
  assert.equal(getAndDeleteIncomingExtra('t2'), undefined)
})

test('deleteIncomingExtra clears an entry left by an early-return path (no leak)', () => {
  setIncomingExtra('t3', { addonName: 'a', filterResult: { flagged: false } as PartialPluginResult })
  deleteIncomingExtra('t3')
  assert.equal(getAndDeleteIncomingExtra('t3'), undefined)
})
