import os from 'os'


const SLACK_POSITIVE = process.env.SLACK_POSITIVE as string
console.info('SLACK_POSITIVE', SLACK_POSITIVE)

let _last = { text: 'dummy', time: 0 }
const timeout = 60 * 60 * 1000 //1 hour

export const slackLogPositive = async (level: ('flagged' | 'warning' | 'test'), text: string) => {

	/** create the string */

	let prefix = os.hostname() + ' 🐐 '

	prefix += (level === 'flagged') ? '⛔ *FLAGGED FILE FOUND* ⛔' : (
		(level === 'warning') ? '⭐️ *WARNING* ⭐️' : '✅ *Test Message* ✅'
	)

	if (process.env.NODE_ENV !== 'production') {
		prefix = 'IGNORE THESE TEST POSTS'
	}

	/** log the message either way */
	console.log(slackLogPositive.name, prefix, text)

	if (!SLACK_POSITIVE) {
		return console.log(slackLogPositive.name, 'no SLACK_POSITIVE url provided.')
	}

	/** dont spam slack */
	const time = Date.now()
	if (text === _last.text && (_last.time + timeout) > time) {
		return
	}
	_last = { text, time }



	try {
		const res = await fetch(SLACK_POSITIVE, {
			method: 'POST',
			body: JSON.stringify({
				text: `${prefix} *${new Date().toUTCString()}*\n${text}`
			})
		})

		return res
	} catch (err: unknown) {
		const e = err as Error & { code?: string }
		console.error(slackLogPositive.name, 'DID NOT WRITE TO SLACK_POSITIVE', (e.code) ? `${e.code}:` : '', e.message)
	}
}


