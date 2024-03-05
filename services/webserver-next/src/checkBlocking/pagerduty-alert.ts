import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { slackLog } from '../../../../libs/utils/slackLog'

const ssmClient = new SSMClient()

const readPagerdutyKey = async () => (await ssmClient.send(new GetParameterCommand({
	Name: '/shepherd/PAGERDUTY_KEY',
	WithDecryption: true, // ignored if unencrypted
}))).Parameter!.Value as string // throws if undefined


/** rate-limit our calls to pagerduty */
const rateLimit = 60_000
const callArgs: { [serverName: string]: { lastCall: number } } = {}

let _PAGERDUTY_KEY: string
let _region: string
let enabled: boolean

const setup = async () => {
	try {
		_region = await ssmClient.config.region()
		console.log(`pagerdutyAlerts region: ${_region}`)
	} catch (err: unknown) {
		const e = err as Error
		console.error(`Error fetching region. ${e.name}:${e.message}`)
	}
	if (_region === 'eu-west-2') {
		try {
			_PAGERDUTY_KEY = await readPagerdutyKey()
			console.log('pagerdutyAlerts: key was retrieved.')
			return true
		} catch (err: unknown) {
			const e = err as Error
			await slackLog(`Error fetching PAGERDUTY_KEY. ${e.message}`)
		}
	}
	return false
}
/** setup these values early in case there is a problem */
setup().then(res => enabled = res)

export const pagerdutyAlert = async (alertString: string, serverName: string) => {

	/** check pagerduty setup and enabled in this region */
	if (enabled === false) {
		return
	} else if (enabled === undefined) {
		enabled = await setup()
		if (enabled === false) {
			return
		}
	}

	/** don't get rate-limited by PagerDuty */
	if (callArgs[serverName] && (Date.now() - callArgs[serverName].lastCall) < rateLimit) {
		return
	}
	callArgs[serverName] = { lastCall: Date.now() }


	/** trigger a pagerduty alert */
	const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			routing_key: _PAGERDUTY_KEY,
			event_action: 'trigger',
			dedup_key: `${_region} ${serverName}`,
			payload: {
				summary: `Shepherd (${_region}) Alert. Content showing on: ${serverName}`,
				source: `Shepherd ${_region}`,
				severity: 'critical',
				custom_details: {
					'All Current Alert Details': alertString,
				}
			},
		}),
	})
	if (res.ok) {
		console.log(`PagerDuty alert sent. ${await res.text()}`)
	} else {
		const errMsg = `PagerDuty alert failed. ${res.status}, a${res.statusText}, ${await res.text()}`
		await slackLog(errMsg)
	}
}
