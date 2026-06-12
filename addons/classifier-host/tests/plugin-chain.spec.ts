import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FilterPluginInterface } from 'shepherd-plugin-interfaces'
import { classifyFrames, runPluginChain } from '../src/plugin-chain'

test('runPluginChain executes all plugins for one buffer', async () => {
  let calls = 0
  const plugins: FilterPluginInterface[] = [
    {
      init: async () => { },
      checkImage: async () => {
        calls++
        return { flagged: false, top_score_name: 'first', top_score_value: 0.1, flag_type: 'classified' }
      },
    },
    {
      init: async () => { },
      checkImage: async () => {
        calls++
        return { flagged: true, top_score_name: 'second', top_score_value: 0.8, flag_type: 'matched' }
      },
    },
    {
      init: async () => { },
      checkImage: async () => {
        calls++
        return { flagged: false, top_score_name: 'third', top_score_value: 0.3 }
      },
    },
  ]

  const result = await runPluginChain(plugins, Buffer.from('abc'), 'image/png', 'txid-1')
  assert.equal(calls, 3)
  assert.equal(result.flagged, true)
  assert.equal(result.flag_type, 'matched')
})

test('classifyFrames exits early after first flagged frame', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'classifier-host-test-'))
  try {
    const frameA = path.join(dir, 'frame-a.png')
    const frameB = path.join(dir, 'frame-b.png')
    await writeFile(frameA, Buffer.from([1, 2, 3]))
    await writeFile(frameB, Buffer.from([4, 5, 6]))

    let calls = 0
    const plugins: FilterPluginInterface[] = [{
      init: async () => { },
      checkImage: async () => {
        calls++
        return { flagged: true, flag_type: 'matched', top_score_name: 'frame-hit', top_score_value: 0.99 }
      },
    }]

    const result = await classifyFrames(plugins, [frameA, frameB], 'txid-2')
    assert.equal(result.flagged, true)
    assert.equal(calls, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
