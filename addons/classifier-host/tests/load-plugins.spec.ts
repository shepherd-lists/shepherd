import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from '../src/0-init/load-plugins'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixtureConfigPath = path.join(testDir, 'fixtures', 'shepherd.config.test.json')

test('loadPlugin loads and initializes the plugin', async () => {
  const plugin = await loadPlugin(fixtureConfigPath)

  const result = await plugin.checkImage(Buffer.from('mock-image-bytes'), 'image/png', 'mock-txid')
  assert.equal(result.flagged, false)
  assert.equal(result.top_score_name, 'mock')
})

test('loadPlugin returns the cached plugin for same config path', async () => {
  const first = await loadPlugin(fixtureConfigPath)
  const second = await loadPlugin(fixtureConfigPath)
  assert.equal(first, second)
})
