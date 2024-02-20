const hookUrl = process.env.SLACK_WEBHOOK as string
console.log('SLACK_WEBHOOK', hookUrl)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const slackLog = async (...args: any) => {

	const text = '[fnOwner]: ' + args.join(' ')

	/** log message either way */
	console.log(slackLog.name, text)

	if (!hookUrl) return console.log(slackLog.name, 'no SLACK_WEBHOOK url provided.')

	/** post to slack */
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), 20_000)
	try {
		const res = await fetch(hookUrl, { method: 'POST', body: JSON.stringify({ text }), signal: controller.signal })

		if (!res.ok) throw new Error(`response not ok: ${res.status}, ${res.statusText}}`)

		console.log(slackLog.name, `response: ${res.status}, ${await res.text()}`) // use up and close connnection
	} catch (e) {
		console.log(slackLog.name, 'error occurred when posting.', e)
	}
}
