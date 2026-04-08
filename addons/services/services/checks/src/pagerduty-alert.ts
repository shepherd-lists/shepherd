import { slackLog } from '../../../libs/utils/slackLog'

/** rate-limit our calls to pagerduty */
const rateLimit = 60_000
const _callArgs: { [serverName: string]: { lastCall: number } } = {}

const _PAGERDUTY_KEY = process.env.PAGERDUTY_KEY
const _enabled = !!_PAGERDUTY_KEY
if (_enabled) console.log('pagerdutyAlerts: key configured.')
else console.log('pagerdutyAlerts: disabled (no PAGERDUTY_KEY env var).')

export const pagerdutyAlert = async (alertString: string, serverName: string) => {

	if (!_enabled) return

	/** don't get rate-limited by PagerDuty */
	if (_callArgs[serverName] && (Date.now() - _callArgs[serverName].lastCall) < rateLimit) {
		return
	}
	_callArgs[serverName] = { lastCall: Date.now() }


	/** trigger a pagerduty alert */
	const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			routing_key: _PAGERDUTY_KEY,
			event_action: 'trigger',
			dedup_key: `shepherd ${serverName}`,
			payload: {
				summary: `Shepherd Alert. Content showing on: ${serverName}`,
				source: 'Shepherd',
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
		const errMsg = `PagerDuty alert failed. ${res.status}, ${res.statusText}, ${await res.text()}`
		await slackLog(errMsg)
	}
}
