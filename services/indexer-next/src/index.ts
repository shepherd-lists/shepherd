import { slackLog } from './utils/slackLog'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** restart on errors */
while (true) {
	try {



	} catch (err: unknown) {
		const e = err as Error
		slackLog(
			`Fatal error occurred: ${e.name}:${e.message}\n`,
			JSON.stringify(e, null, 2),
			'\nrestarting in 10 seconds...'
		)
		await sleep(10_000)
	}
}
