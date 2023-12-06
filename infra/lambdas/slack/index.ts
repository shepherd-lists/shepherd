import { Handler, SNSEvent } from 'aws-lambda'


interface AlarmMessage {
	"AlarmName": string
	"AlarmDescription": string
	"AWSAccountId": string
	"AlarmConfigurationUpdatedTimestamp": Date
	"NewStateValue": "OK" | "ALARM"
	"NewStateReason": string
	"StateChangeTime": string //DateTime string
	"Region": "EU (Frankfurt)" | string
	"AlarmArn": string
	"OldStateValue": "ALARM" | "OK"
	"OKActions": string[]
	"AlarmActions": string[]
	"InsufficientDataActions": string[]
	"Trigger": {
		"MetricName": string
		"Namespace": "shepherd" | string
		"StatisticType": string
		"Statistic": "SUM" | string
		"Unit": string
		"Dimensions": Record<string, string>
		"Period": number
		"EvaluationPeriods": number
		"DatapointsToAlarm": number
		"ComparisonOperator": string
		"Threshold": number
		"TreatMissingData": "notBreaching" | string
		"EvaluateLowSampleCountPercentile": string
	}
}

export const handler: Handler = async (event: SNSEvent): Promise<any> => {
	console.log(`process.env.SLACK_PUBLIC`, process.env.SLACK_PUBLIC)
	console.log('event: ', JSON.stringify(event, null, 2))

	const parseMessage = () => {
		const m = event.Records[0].Sns.Message
		try {
			return JSON.parse(m)
		} catch (e) {
			return m
		}
	}
	const message = parseMessage()

	console.log('message: ', event.Records[0].Sns.Message)
	let text = ''
	if (message.AlarmName) {
		const alarmMsg: AlarmMessage = message
		const icon = alarmMsg.NewStateValue === 'ALARM' ? `⛔` : `✅`
		const stateChangeMins = ((+alarmMsg.Trigger?.Period * +alarmMsg.Trigger?.EvaluationPeriods) / 60).toFixed(1)
		text = `${alarmMsg.AlarmDescription} ${icon} ${alarmMsg.NewStateValue} triggered in last ${stateChangeMins} minutes\n`
			+ `${alarmMsg.NewStateReason} @ ${alarmMsg.StateChangeTime}`
	} else {
		text = message
	}

	const res = await fetch(process.env.SLACK_PUBLIC!, {
		method: 'POST',
		body: JSON.stringify({
			text,
		}),
	})
	const slackRes = {
		status: res.status,
		statusText: res.statusText,
		body: await res.text(),
	}
	console.log('slackRes: ', JSON.stringify(slackRes, null, 2))
	if (!res.ok) throw new Error(`error sending to slack`, { cause: slackRes })
	return slackRes;
}