import { App, Stack } from 'aws-cdk-lib'

/** standard stack boilerplate */
const app = new App()
const stack = new Stack(app, 'NsfwStack', {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: process.env.CDK_DEFAULT_REGION,
	},
})

