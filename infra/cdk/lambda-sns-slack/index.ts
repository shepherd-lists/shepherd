import { Handler, SNSEvent, SNSHandler } from 'aws-lambda'


export const handler: Handler = async (event: SNSEvent): Promise<any> => {
	console.log(`process.env.SLACK_PROBE`, process.env.SLACK_PROBE)
	console.log('event: ', JSON.stringify(event, null, 2))

	const message = event.Records[0].Sns.Message
	console.log('message: ', message)

	const res = await fetch(process.env.SLACK_PROBE!, {
		method: 'POST',
		body: JSON.stringify({
			text: message,
		}),
	})
	const slackRes = {
		status: res.status,
		statusText: res.statusText,
		body: await res.text(),
	}
	console.log('slackRes: ', JSON.stringify(slackRes, null, 2))
	if(!res.ok) throw new Error(`error sending to slack`, { cause: slackRes })
	return slackRes;
}

