import 'dotenv/config'
import { tipLoop } from '../services/indexer-next/src/index-by-height/index-by-height'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test'


describe('indexer-next tests', {}, () => {

	beforeEach(async () => {

	})
	afterEach(async () => {

	})

	it('should test the tipLoop function', async () => {
		let count = 0
		const gqlHeightMock = mock.fn(async (s: string) => {
			count++
			if (count === 1) return 1 // set current
			if (count === 2) return 1 // set next
			if (count === 3) return 2 // wait loop
			return 4
		})
		const sleepMock = mock.fn(async () => { })


		await tipLoop(false, sleepMock, gqlHeightMock)

		gqlHeightMock.mock.calls
		assert.equal(gqlHeightMock.mock.calls.length, 3)


	})
})
