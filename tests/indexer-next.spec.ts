import 'dotenv/config'
import { tipLoop } from '../services/indexer-next/src/index-by-height'
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
		const gqlLoopMock = mock.fn(async ({ min, max }) => {
			console.debug('querying blocks', { min, max })
			if (count === 4) throw new Error('test finished')
		})


		try {
			await tipLoop(true, sleepMock, gqlHeightMock, gqlLoopMock)
		} catch (e) {
			if ((e as Error).message !== 'test finished') throw e
		}

		assert.deepEqual(gqlLoopMock.mock.calls[0].arguments, [{ min: 0, max: 1 }])
		assert.deepEqual(gqlLoopMock.mock.calls[1].arguments, [{ min: 1, max: 2 }])
		assert.deepEqual(gqlLoopMock.mock.calls[2].arguments, [{ min: 3, max: 4 }])
	})


})
