import loadConfig from '../src/utils/load-config'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'fs/promises'


describe('load-config tests', () => {
	it('tests that config gets loaded', async () => {
		const config = await loadConfig('shepherd.config.test.json')
		assert(config.plugins.length > 0)
		assert(typeof config.plugins[0].init === 'function')
		assert(typeof config.plugins[0].checkImage === 'function')

		const pic = await fs.readFile('./tests/fixtures/test.png')
		const res = await config.plugins[0].checkImage(pic, 'image/png', '123-fake-txid')
		assert(res.flagged === false)

	})
})