import pg from 'libs/utils/pgClient'
import { slackLog } from 'libs/utils/slackLog'
import { infraction_limit } from 'libs/constants'
import { s3GetObjectStream, s3PutObject } from './s3-services';
import { readlineWeb } from 'libs/utils/webstream-utils';


/**
 * N.B. ** WE DONT WANT THIS RUNNING SOLELY ON AN EVENT LOOP ***
 * that would only be to pick up manual updates to the owners_list table
 * when an infraction count is incremented and breached, the `/addresses.txt` should be updated immediately
 */
let _currentCount: number //minimise s3 calls
export const updateAddresses = async () => {
	try {

		if (!_currentCount) {
			try {
				const stream = await s3GetObjectStream(process.env.LISTS_BUCKET!, 'addresses.txt')
				for await (const line of readlineWeb(stream)) {
					_currentCount++
				}
			} catch (err: unknown) {
				const e = err as Error
				if (e.name === 'NoSuchKey') {
					await slackLog(updateAddresses.name +
						` "${e.name}:${e.message}" key='addresses.txt'. we'll be creating new object`
					)
				} else {
					throw e
				}
			}
		}

		/** addresses should be pretty small, otherwise we might use streams */
		let { rows } = await pg.query(
			`SELECT owner FROM owners_list WHERE add_method = 'manual' OR infractions > $1;`,
			[infraction_limit]
		)
		const owners = rows.map((row: { owner: string }) => row.owner)
		console.log('owners', owners)

		if (owners.length !== _currentCount) {
			console.info('updating addresses.txt...')
			await s3PutObject(process.env.LISTS_BUCKET!, 'addresses.txt', owners.join('\n') + '\n')
		}


		return _currentCount = owners.length

	} catch (err: unknown) {
		const e = err as Error
		slackLog(updateAddresses.name, `${e.name}:${e.message}`, JSON.stringify(e))
		throw e;
	}


}