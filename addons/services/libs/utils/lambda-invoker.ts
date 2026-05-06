import { slackLog } from './slackLog'
import { readParamJsonLive, writeParamJsonLive } from './redis-state'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** lazy-load handlers to avoid circular dependency (lambdas import from libs/) */
const getHandler = async (name: string): Promise<(event: any) => Promise<any>> => {
	switch (name) {
		case 'fnInitLists': return (await import('../../libFunctions/fnInitLists/index')).handler
		case 'fnTemp': return (await import('../../libFunctions/fnTemp/index')).handler
		default: throw new Error(`Unknown handler: '${name}'. Available: fnInitLists, fnTemp`)
	}
}

/** invoke a lambda handler directly. N.B. defaults to infinite retries */
export const lambdaInvoker = async (handlerName: string, payload: object, retries?: number) => {
	const totalRetries = retries
	const handler = await getHandler(handlerName)

	while (true) {
		try {
			const result = await handler(payload)
			console.info(handlerName, `returned ${result}`)
			return result
		} catch (err: unknown) {
			const e = err as Error

			if (retries !== undefined && --retries <= 0) {
				throw new Error(`${handlerName} failed after ${totalRetries} retries. Last error: ${e.message}`)
			}

			slackLog(handlerName, `HANDLER ERROR ${e.name}:${e.message}. retrying after 10 seconds`, e)
			await sleep(10_000)
			continue
		}
	}
}

/** 
 * everything below is temporary for fnTemp lambda.
 * TODO: remove this once fnTemp is removed.
 */

interface FnTempState {
	isRunning: boolean
	oneMoreRun: boolean
	lastRun: number // unix timestamp
}

const SSM_PARAMETER_NAME = 'fnTemp-state'

const getFnTempState = async () => {
	try {
		return await readParamJsonLive(SSM_PARAMETER_NAME) as FnTempState
	} catch (error) {
		// Parameter doesn't exist, return default state
		return { isRunning: false, oneMoreRun: false, lastRun: 0 }
	}
}

const setFnTempState = async (state: FnTempState) => writeParamJsonLive(SSM_PARAMETER_NAME, state)

/**
 * Dedicated function for fnTemp lambda calls.
 * Prevents multiple simultaneous executions by using an SSM parameter.
 * Handles 4 possible states:
 * - { isRunning: false, oneMoreRun: false } - idle
 * - { isRunning: false, oneMoreRun: true } - idle but should run again  
 * - { isRunning: true, oneMoreRun: false } - currently running
 * - { isRunning: true, oneMoreRun: true } - running with pending run
 */
export const lambdaInvokerFnTemp = async () => {
	// Get the current state
	let currentState = await getFnTempState()
	if (currentState.isRunning && currentState.lastRun < Date.now() - 300_000) { //in case the service running ended unexpectedly, reset the state
		currentState = { isRunning: false, oneMoreRun: false, lastRun: 0 }
	}
	console.info('ENTRY', lambdaInvokerFnTemp.name, `DEBUG`, JSON.stringify(currentState))

	do {
		try {
			// Handle the 4 possible states
			if (!currentState.isRunning && !currentState.oneMoreRun) {
				console.info('// State: idle - set to running and invoke')
				await setFnTempState({ isRunning: true, oneMoreRun: false, lastRun: Date.now() })
				await lambdaInvoker('fnTemp', {}, 0)
				currentState = await getFnTempState()
				currentState.isRunning = false
				await setFnTempState(currentState)
			} else if (!currentState.isRunning && currentState.oneMoreRun) {
				console.info('// State: idle but should run again - set to running and invoke')
				await setFnTempState({ isRunning: true, oneMoreRun: false, lastRun: Date.now() })
				await lambdaInvoker('fnTemp', {}, 0)
				currentState = await getFnTempState()
				currentState.isRunning = false
				await setFnTempState(currentState)
			} else if (currentState.isRunning && !currentState.oneMoreRun) {
				console.info('// State: currently running - mark that another run is needed')
				await setFnTempState({ isRunning: true, oneMoreRun: true, lastRun: currentState.lastRun })
				return // Exit without invoking, let the running instance handle it
			} else if (currentState.isRunning && currentState.oneMoreRun) {
				console.info('// State: running with pending run - do nothing, already queued')
				return
			}
		} catch (e) {
			if (e instanceof Error && e.name === 'TooManyUpdates') {
				console.info('// Error - retry', e)
				await sleep(100)
				currentState = await getFnTempState()
				continue
			}
			console.info('// Error - throw', e)
			throw e
		}
		currentState = await getFnTempState()
	} while (currentState.oneMoreRun)
}

