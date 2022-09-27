import { IncomingWebhook } from '@slack/webhook'
import { logger } from '../shepherd-plugin-interfaces/logger'
import os from 'os'

console.assert(process.env.SLACK_WEBHOOK, "process.env.SLACK_WEBHOOK is undefined")
let webhook: IncomingWebhook
if(process.env.SLACK_WEBHOOK){
	webhook = new IncomingWebhook(process.env.SLACK_WEBHOOK!)
}

let _last = { text: 'dummy', time: 0}
const timeout = 60*60*1000 //1 hour

export const slackLogger = async (...args: any[]) => {
	if(!process.env.SLACK_WEBHOOK){
		return; //silently exit if no slack integration
	}

	let prefix = os.hostname() + ' 🐐'
	if(process.env.NODE_ENV !== 'production'){
		prefix = '***Ignore these test posts***'
	}

	let text = args.join(' ')
	const time = Date.now()

	if(text === _last.text && (_last.time + timeout) > time ){
		return;
	}
	_last = { text, time }

	try{
		const res = await webhook.send({
			"blocks": [
				{
					"type": "section", 
					"text": {
						"type": "mrkdwn",
						"text": `${prefix} *${new Date().toUTCString()}*`,
					} 
				},
				{
					"type": "section", 
					"text": {
						"type": "mrkdwn",
						"text": text,
					} 
				}
			]
		})
		return res
	}catch(e:any){
		logger('slackLogger', 'DID NOT WRITE TO SLACK', (e.code)?`${e.code}:`:'', e.message)
	}
}
