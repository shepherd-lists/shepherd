import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { FilterPluginInterface, FilterResult } from 'shepherd-plugin-interfaces'
import { classifyFrames, classifyImage } from '../src/2-processing/classify'

describe('classifyImage', () => {
  test('returns the plugin result for one buffer', async () => {
    let calls = 0
    const plugin: FilterPluginInterface = {
      init: async () => { },
      checkImage: async () => {
        calls++
        return { flagged: true, top_score_name: 'hit', top_score_value: 0.8, flag_type: 'matched' }
      },
    }

    const result = await classifyImage(plugin, Buffer.from('abc'), 'image/png', 'txid-1') as FilterResult
    assert.equal(calls, 1)
    assert.equal(result.flagged, true)
    assert.equal(result.flag_type, 'matched')
  })
})

describe('classifyFrames', () => {
  test('stops at the first flagged frame', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'classifier-host-test-'))
    try {
      const frameA = path.join(dir, 'frame-a.png')
      const frameB = path.join(dir, 'frame-b.png')
      await writeFile(frameA, Buffer.from([1, 2, 3]))
      await writeFile(frameB, Buffer.from([4, 5, 6]))

      let calls = 0
      const plugin: FilterPluginInterface = {
        init: async () => { },
        checkImage: async () => {
          calls++
          return { flagged: true, flag_type: 'matched', top_score_name: 'frame-hit', top_score_value: 0.99 }
        },
      }

      const result = await classifyFrames(plugin, [frameA, frameB], dir, 'txid-2')
      assert.equal(result.flagged, true)
      assert.equal(calls, 1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('checks the first frame alone before batching the rest', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'classifier-host-test-'))
    try {
      const framePaths: string[] = []
      for (let i = 0; i < 8; i++) {
        const framePath = path.join(dir, `frame-${i}.png`)
        await writeFile(framePath, Buffer.from([i]))
        framePaths.push(framePath)
      }

      /* track concurrency: the first frame must run alone, then remaining 7 run in batches of 5 */
      let inflight = 0
      let maxInflight = 0
      const callOrder: number[] = []
      const plugin: FilterPluginInterface = {
        init: async () => { },
        checkImage: async (buffer: Buffer) => {
          callOrder.push(buffer[0])
          inflight++
          maxInflight = Math.max(maxInflight, inflight)
          /* hold longer than any filesystem-read jitter so all frames in a batch reliably overlap */
          await new Promise(resolve => setTimeout(resolve, 10))
          inflight--
          return { flagged: false, top_score_name: 'clean', top_score_value: 0.1 }
        },
      }

      const result = await classifyFrames(plugin, framePaths, dir, 'txid-batch')
      assert.equal(result.flagged, false)
      assert.equal(callOrder.length, 8)
      assert.equal(callOrder[0], 0) // first frame checked first
      assert.equal(maxInflight, 5) // remaining frames batched 5-wide
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('flags a positive frame found inside a later batch', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'classifier-host-test-'))
    try {
      const framePaths: string[] = []
      for (let i = 0; i < 4; i++) {
        const framePath = path.join(dir, `frame-${i}.png`)
        await writeFile(framePath, Buffer.from([i]))
        framePaths.push(framePath)
      }

      const plugin: FilterPluginInterface = {
        init: async () => { },
        checkImage: async (buffer: Buffer) => buffer[0] === 2
          ? { flagged: true, flag_type: 'matched', top_score_name: 'hit', top_score_value: 0.97 }
          : { flagged: false, top_score_name: 'clean', top_score_value: 0.1 },
      }

      const result = await classifyFrames(plugin, framePaths, dir, 'txid-batch-hit') as FilterResult
      assert.equal(result.flagged, true)
      assert.equal(result.top_score_name, 'hit')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('delegates the whole frame folder to a plugin that implements checkImageDir', async () => {
    let dirCalls = 0
    let checkImageCalls = 0
    let receivedDir: string | undefined
    let receivedMime: string | undefined
    const plugin: FilterPluginInterface = {
      init: async () => { },
      checkImage: async () => {
        checkImageCalls++
        return { flagged: false, top_score_name: 'clean', top_score_value: 0.1 }
      },
      checkImageDir: async (framesDir, mimetype) => {
        dirCalls++
        receivedDir = framesDir
        receivedMime = mimetype
        return { flagged: true, flag_type: 'matched', top_score_name: 'dir-hit', top_score_value: 0.98 }
      },
    }

    const result = await classifyFrames(plugin, ['/ignored/frame-a.png'], '/frames-dir', 'txid-dir') as FilterResult
    assert.equal(result.flagged, true)
    assert.equal(result.top_score_name, 'dir-hit')
    assert.equal(dirCalls, 1)
    assert.equal(checkImageCalls, 0) // per-frame path not used when checkImageDir exists
    assert.equal(receivedDir, '/frames-dir')
    assert.equal(receivedMime, 'image/png')
  })
})
