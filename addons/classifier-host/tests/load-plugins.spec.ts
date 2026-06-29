import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { FilterResult } from 'shepherd-plugin-interfaces'
import { loadPlugin } from '../src/0-init/load-plugins'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const fixtureConfigPath = path.join(testDir, 'fixtures', 'shepherd.config.test.json')

const writeConfig = async (contents: unknown) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'classifier-host-cfg-'))
  const configPath = path.join(dir, 'shepherd.config.json')
  await writeFile(configPath, JSON.stringify(contents))
  return configPath
}

describe('loadPlugin', () => {
  test('loads and initializes the first plugin from the `plugins` array', async () => {
    const plugin = await loadPlugin(fixtureConfigPath)

    const result = await plugin.checkImage(Buffer.from('mock-image-bytes'), 'image/png', 'mock-txid') as FilterResult
    assert.equal(result.flagged, false)
    assert.equal(result.top_score_name, 'mock')
  })

  test('rejects a config that is missing the `plugins` array', async () => {
    const configPath = await writeConfig({})
    await assert.rejects(() => loadPlugin(configPath), /'plugins' must be a non-empty array/)
  })

  test('rejects an empty `plugins` array', async () => {
    const configPath = await writeConfig({ plugins: [] })
    await assert.rejects(() => loadPlugin(configPath), /'plugins' must be a non-empty array/)
  })

  test('returns the cached plugin for same config path', async () => {
    const first = await loadPlugin(fixtureConfigPath)
    const second = await loadPlugin(fixtureConfigPath)
    assert.equal(first, second)
  })
})
