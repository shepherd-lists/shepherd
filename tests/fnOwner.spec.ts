import 'dotenv/config'
import { handler } from '../lambdas/fnOwnerBlocking/index'
import { ownerBlockingEvent, ownerBlockingEventOwners } from './assets/fnOwner-page-event'
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import { dropOwnerTables, createOwnerTable } from '../libs/block-owner/owner-table-utils'


describe('fnOwnerBlocking tests', () => {

	before(async () => {
		await Promise.all(
			ownerBlockingEventOwners.map(o => createOwnerTable(o))
		)
	})

	after(async () => {
		await Promise.all(
			ownerBlockingEventOwners.map(o => dropOwnerTables(o))
		)
	})

	it('should process a page of results', async () => {
		console.info(`NODE_ENV`, process.env.NODE_ENV)

		const result = await handler(ownerBlockingEvent)

		assert.equal(result.total, 3)

	})

})