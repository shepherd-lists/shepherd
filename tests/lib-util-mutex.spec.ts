import assert from "node:assert/strict"
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { createMutex } from '../libs/utils/mutex'


describe('mutex', () => {
	it('should allow only one task to run at a time from each scope', async () => {
		const mutex1 = createMutex()
		const mutexA = createMutex()
		const completed1: string[] = []
		const completedA: string[] = []

		const tasks1 = ['1', '2', '3'].map(taskId => mutex1.runExclusive(async (id: string) => {
			// console.log(`Task ${id} acquired lock`)
			await new Promise((resolve) => setTimeout(resolve, 100))
			completed1.push(id)
			// console.log(`Task ${id} releasing lock`)
		}, taskId))

		const tasksA = ['A', 'B', 'C'].map(taskid => mutexA.runExclusive(async (id: string) => {
			// console.log(`Task ${id} acquired lock`)
			await new Promise((resolve) => setTimeout(resolve, 100))
			completedA.push(id)
			// console.log(`Task ${id} releasing lock`)
		}, taskid))

		await Promise.all([...tasks1, ...tasksA])

		assert.deepEqual(completed1, ['1', '2', '3'])
		assert.deepEqual(completedA, ['A', 'B', 'C'])


	})

})