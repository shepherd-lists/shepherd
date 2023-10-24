import { IncomingWebhook } from '@slack/webhook'
import { logger } from './logger'
import os from 'os'
import { APIFilterResult } from '../shepherd-plugin-interfaces'

console.assert(process.env.SLACK_POSITIVE, 'process.env.SLACK_POSITIVE is undefined')
let webhook: IncomingWebhook
if(process.env.SLACK_POSITIVE){
	webhook = new IncomingWebhook(process.env.SLACK_POSITIVE!)
}

let _last = { text: 'dummy', time: 0}
const timeout = 60*60*1000 //1 hour

export const slackLoggerPositive = async (level: ('matched'|'warning'|'test'), text: string) => {
	if(!process.env.SLACK_POSITIVE){
		return //silently exit if no SLACK_POSITIVE integration
	}

	let prefix = os.hostname() + ' 🐐 '

	prefix += (level === 'matched') ? '⛔ *MATCHED FILE FOUND* ⛔' : (
		(level === 'warning') ? '⭐️ *WARNING* ⭐️' : '✅ *Test Message* ✅'
	)

	if(process.env.NODE_ENV !== 'production'){
		prefix = '***Ignore these test posts***'
	}

	const time = Date.now()

	if(text === _last.text && (_last.time + timeout) > time ){
		return
	}
	_last = { text, time }

	try{
		const res = await webhook.send({
			'blocks': [
				{
					'type': 'section',
					'text': {
						'type': 'mrkdwn',
						'text': `${prefix} ${new Date().toUTCString()}`,
					}
				},
				{
					'type': 'section',
					'text': {
						'type': 'mrkdwn',
						'text': text,
					}
				}
			]
		})
		return res
	}catch(err:unknown){
		const e = err as Error & { code?: string }
		logger(slackLoggerPositive.name, 'DID NOT WRITE TO SLACK_POSITIVE', (e.code)?`${e.code}:`:'', e.message)
	}
}


