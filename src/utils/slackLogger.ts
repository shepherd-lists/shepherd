import { IncomingWebhook } from '@slack/webhook'
import { logger } from './logger'

console.assert(process.env.SLACK_WEBHOOK, "process.env.SLACK_WEBHOOK is undefined")
let webhook: IncomingWebhook
if(process.env.SLACK_WEBHOOK){
	webhook = new IncomingWebhook(process.env.SLACK_WEBHOOK!)
}


export const slackLogger = async (...args: any[]) => {
	if(!process.env.SLACK_WEBHOOK){
		return; //silently exit if no slack integration
	}

	let prefix = '🐐'
	if(process.env.NODE_ENV !== 'production'){
		prefix = '***Ignore these test posts***'
	}

	try{
		let text = args.join(' ')

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
		logger('slackLogger', 'did not write to slack', (e.code)?`${e.code}:`:'', e.message)
	}
}
