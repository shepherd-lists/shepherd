import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { slackLog } from './slackLog'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const lambdaInvoker = async (FunctionName: string, payload: object, retries?: number) => {
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
				throw new Error(`${FunctionName} failed after retries. Last error: ${e.message}`)
			}

			slackLog(FunctionName, `LAMBDA ERROR ${e.name}:${e.message}. retrying after 10 seconds`, e)
			await sleep(10_000)
			continue; //consider not retrying indefinitely
		}
	}
}
