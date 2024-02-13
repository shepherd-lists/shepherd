import { slackLog } from './utils/slackLog'
import { createOwnerTable } from './utils/owner-table-utils'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const lambdaClient = new LambdaClient({})


/** restart on errors */
let runonce = true
while (true) {
	try {

		if (runonce) {
			console.info('create owner table.')
			const owner = 'v2XXwq_FvVqH2KR4p_x8H-SQ7rDwZBbykSv-59__Avc'
			const tablename = await createOwnerTable(owner)
			console.info('owner table created.')

			console.info("let's start a lambda")
			//import lambda name
			const fnOwnerTable = process.env.FN_OWNER_TABLE as string
			console.info('fnOwnerTable', fnOwnerTable)
			const res = await lambdaClient.send(new InvokeCommand({
				FunctionName: fnOwnerTable,
				Payload: JSON.stringify({ owner, tablename }),
				// InvocationType: 'RequestResponse'
			}))
			console.info('res', res)
			runonce = false
		}


		console.info('nothing to do. ssleeping for 50 seconds...')
		await new Promise(resolve => setTimeout(resolve, 50_000))


	} catch (err: unknown) {
		const e = err as Error
		slackLog(
			`Fatal error occurred: ${e.name}:${e.message}\n`,
			JSON.stringify(e, null, 2),
			'\nrestarting in 30 seconds...'
		)
		await sleep(30_000)
	}
}
