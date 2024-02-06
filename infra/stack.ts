import { App, Stack } from 'aws-cdk-lib'
import { Config } from '../../../Config'


export const createStack = async (app: App, config: Config) => {
	const stack = new Stack(app, 'IndexerNext', {
		env: {
			account: process.env.CDK_DEFAULT_ACCOUNT,
			region: config.region,
		},
		stackName: 'indexer-next',
		description: 'indexer run as a private addon'
	})



}