import { IncomingWebhook } from '@slack/webhook'
import { logger } from './logger'
import os from 'os'

console.assert(process.env.SLACK_WEBHOOK, 'process.env.SLACK_WEBHOOK is undefined')
let webhook: IncomingWebhook
if(process.env.SLACK_WEBHOOK){
	webhook = new IncomingWebhook(process.env.SLACK_WEBHOOK!)
}

let _last = { text: 'dummy', time: 0}
const timeout = 60*60*1000 //1 hour

/**
 * Posts a message to slack. If the message is the same as the last message, it will not be posted
 * again until 1 hour has passed.
 * @param args objects need to have a toString() method
 */
export const slackLogger = async (...args: Array<{ toString():string }>) => {
	if(!process.env.SLACK_WEBHOOK){
		return //silently exit if no slack integration
	}

	let prefix = os.hostname() + ' 🐐'
	if(process.env.NODE_ENV !== 'production'){
		prefix = '***Ignore these test posts***'
	}

	const text = args.join(' ')
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
						'text': `${prefix} *${new Date().toUTCString()}*`,
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
		logger('slackLogger', 'DID NOT WRITE TO SLACK', (e.code)?`${e.code}:`:'', e.message)
	}
}
