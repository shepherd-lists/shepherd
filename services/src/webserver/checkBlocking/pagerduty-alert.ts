import { SecretsManager } from '@aws-sdk/client-secrets-manager'
import { slackLogger } from '../../common/utils/slackLogger'

const secretsManager = new SecretsManager()

const getSecret = async (secretKey: string) => {
	const region = await secretsManager.config.region()
	try {
		const res = await secretsManager.getSecretValue({ SecretId: `shepherd/${secretKey}` })
		if (res.SecretString) {
			console.log(`SecretsManager: retrieved secret 'shepherd/${secretKey}' ok.`)
			return res.SecretString
		}
		throw new Error('SecretString not defined.')
	} catch (err: unknown) {
		const e = err as Error
		throw new Error(`SecretsManager: error fetching 'shepherd/${secretKey}' in region ${region}. ${e.name}:${e.message}`)
	}

}

/** rate-limit our calls to pagerduty */
const rateLimit = 60_000
const callArgs: { [serverName: string]: { lastCall: number } } = {}

let _PAGERDUTY_KEY: string
let _region: string
export const pagerdutyAlert = async (alertString: string, serverName: string) => {

	/** don't get rate-limited by PagerDuty */
	if (callArgs[serverName] && (Date.now() - callArgs[serverName].lastCall) < rateLimit) {
		return;
	}
	callArgs[serverName] = { lastCall: Date.now() }

	/** only call these once */
	if (!_PAGERDUTY_KEY) {
		try {
			_PAGERDUTY_KEY = await getSecret('PAGERDUTY_KEY')
		} catch (err: unknown) {
			const e = err as Error
			if (e.message.includes('ResourceNotFoundException')) {
				/** this means pagerduty is not set up for this region */
				callArgs[serverName].lastCall = 4092512698 // don't call again until 2099 AD
				return;
			}
		}
	}
	if (!_region) {
		_region = await secretsManager.config.region()
	}

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
		console.error(errMsg)
		slackLogger(errMsg)
	}
}
