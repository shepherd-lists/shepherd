import Config from '../src/utils/load-config'
import { expect } from 'chai'
import fs from 'fs/promises'


describe('load-config tests', () => {
	it('tests that config gets loaded', async () => {
		const config = await Config()
		expect(config.lowmem).to.be.a('boolean')
		expect(config.plugins.length).greaterThan(0)
		expect(config.plugins[0].init).to.be.a('function')
		expect(config.plugins[0].checkImage).to.be.a('function')

		const pic = await fs.readFile('./tests/fixtures/test.png')
		const res = await config.plugins[0].checkImage(pic, 'image/png', '123-fake-txid')
		expect(res.flagged).false

	}).timeout(0)
})