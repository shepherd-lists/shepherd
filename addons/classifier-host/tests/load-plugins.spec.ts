import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadPlugins } from '../src/load-plugins'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixtureConfigPath = path.join(testDir, 'fixtures', 'shepherd.config.test.json')

test('loadPlugins loads and initializes plugins', async () => {
  const plugins = await loadPlugins(fixtureConfigPath)
  assert.equal(plugins.length, 1)

  const result = await plugins[0].checkImage(Buffer.from('mock-image-bytes'), 'image/png', 'mock-txid')
  assert.equal(result.flagged, false)
  assert.equal(result.top_score_name, 'mock')
})

test('loadPlugins returns cached plugins for same config path', async () => {
  const first = await loadPlugins(fixtureConfigPath)
  const second = await loadPlugins(fixtureConfigPath)
  assert.equal(first, second)
})
