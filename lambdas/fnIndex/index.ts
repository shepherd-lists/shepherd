import { slackLog } from '../../libs/utils/slackLog'


/** the handler will receive 1 page of new items to index. */
export const handler = async (event: any) => {
	let count = 0
	try {
		console.info('event', JSON.stringify(event))
		/* check inputs */



		return count;
	} catch (err: unknown) {
		const e = err as Error
		await slackLog('fnIndexer.handler', `Fatal error ❌ ${e.name}:${e.message}`, JSON.stringify(e))
		throw e
	}
}