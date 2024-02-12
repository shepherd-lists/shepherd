import pg from './utils/pgClient'
import { slackLog } from './utils/slackLog'


export const handler = async (event: any) => {
	console.log('event', event)

	await slackLog('fnOwnerTable', 'event', JSON.stringify(event))

	try {
		const res = await pg.query('SELECT  1;')
		console.log('connected to rds', res)
	} catch (e) {
		console.error('error connecting to rds', e)
	}




	return event
}