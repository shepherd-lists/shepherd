const hookUrl = process.env.SLACK_WEBHOOK as string
console.log('SLACK_WEBHOOK', hookUrl)

export const slackLog = async (...args: any) => {

	const text = args.join(' ')

	/** log message either way */
	console.log(slackLog.name, text)

	if (!hookUrl) return console.log(slackLog.name, 'no SLACK_WEBHOOK url provided.')

	try {
		const res = await fetch(hookUrl, { method: 'POST', body: JSON.stringify({ text }) })

		if (!res.ok) throw new Error(`response not ok: ${res.status}, ${res.statusText}}`)

		console.log(slackLog.name, `response: ${res.status}, ${await res.text()}`) // use up and close connnection
	} catch (e) {
		console.log(slackLog.name, 'error occurred when posting.', e)
	}
}
