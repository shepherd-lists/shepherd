import { SecretsManager } from '@aws-sdk/client-secrets-manager'
import { slackLogger } from '../../common/utils/slackLogger'

const secretsManager = new SecretsManager()

const getSecret = async (secretKey: string) => {
	const region = await secretsManager.config.region()
	try{
		const res = await secretsManager.getSecretValue({ SecretId: `shepherd/${secretKey}` })
		if(res.SecretString){
			return res.SecretString
		}
		throw new Error('SecretString not defined.')
	}catch(err: unknown){
		const e = err as Error
		throw new Error(`SecretsManager: error fetching 'shepherd/${secretKey}' in region ${region}. ${e.name}:${e.message}`)
	}

}

export const pagerdutyAlert = async(alertString: string, serverName: string) => {
	/** use AWS secrets to fetch our api key */
	const PAGERDUTY_KEY = await getSecret('PAGERDUTY_KEY')
	const region = await secretsManager.config.region()
	const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			routing_key: PAGERDUTY_KEY,
			event_action: 'trigger',
			dedup_key: `${region} ${serverName}`,
			payload: {
				summary: `Shepherd (${region}) Alert. Content showing on: ${serverName}`,
				source: `Shepherd ${region}`,
				severity: 'critical',
				custom_details: {
					'All Current Alert Details': alertString,
				}
			},
		}),
	})
	if(res.ok){
		console.log(`PagerDuty alert sent. ${await res.text()}`)
	}else{
		const errMsg = `PagerDuty alert failed. ${res.status}, a${res.statusText}, ${await res.text()}`
		console.error(errMsg)
		slackLogger(errMsg)
	}
}
