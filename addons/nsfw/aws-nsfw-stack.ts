import { App, Stack } from 'aws-cdk-lib'

/** check mandatoy envs exist */
const envs = [
	'DB_HOST',
	'AWS_SQS_INPUT_QUEUE',
	'AWS_INPUT_BUCKET',
	'AWS_DEFAULT_REGION',
	'HTTP_API_URL',
]
envs.map((name: string) => {
	if (!process.env[name]) throw new Error(`${name} not set`)
})

/** standard stack boilerplate */
const app = new App()
const stack = new Stack(app, 'NsfwStack', {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: process.env.CDK_DEFAULT_REGION,
	},
})

