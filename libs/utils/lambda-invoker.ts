import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { slackLog } from './slackLog'
import { readParamJsonLive, writeParamJsonLive } from './ssmParameters'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** N.B. defaults to infinite retries */
export const lambdaInvoker = async (FunctionName: string, payload: object, retries?: number) => {
	const totalRetries = retries
	const lambdaClient = new LambdaClient({})

	while (true) {
		try {
			const res = await lambdaClient.send(new InvokeCommand({
				FunctionName,
				Payload: JSON.stringify(payload),
				InvocationType: 'RequestResponse',
			}))
			if (res.FunctionError) {
				let payloadMsg = ''
				try { payloadMsg = new TextDecoder().decode(res.Payload) }
				catch (e) { payloadMsg = 'error decoding Payload with res.FunctionError' }
				throw new Error(`Lambda error '${res.FunctionError}', payload: ${payloadMsg}`)
			}

			const lambdaReturn = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))
			console.info(FunctionName, `returned ${lambdaReturn}`)

			return lambdaReturn;
		} catch (err: unknown) {
			const e = err as Error

			if (retries !== undefined && --retries <= 0) {
				throw new Error(`${FunctionName} failed after ${totalRetries} retries. Last error: ${e.message}`)
			}

			slackLog(FunctionName, `LAMBDA ERROR ${e.name}:${e.message}. retrying after 10 seconds`, e)
			await sleep(10_000)
			continue; //consider not retrying indefinitely
		}
	}
}

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
				await lambdaInvoker(process.env.FN_TEMP!, {}, 0)
				currentState = await getFnTempState()
				currentState.isRunning = false
				await setFnTempState(currentState)
			} else if (!currentState.isRunning && currentState.oneMoreRun) {
				console.info('// State: idle but should run again - set to running and invoke')
				await setFnTempState({ isRunning: true, oneMoreRun: false, lastRun: Date.now() })
				await lambdaInvoker(process.env.FN_TEMP!, {}, 0)
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

