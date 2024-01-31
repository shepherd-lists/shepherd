import { App } from 'aws-cdk-lib'
import { Config } from './Config'
import { InfraStack } from './infra/stack'
import { ServicesStack } from './services/infra/stack'

const configName = process.argv[2]

const config: Config = (await import(`./config.${configName}.ts`)).config
if (!config) throw new Error(`config not set. configName: ${configName}`)

const app = new App()

new InfraStack(app, 'InfraStack', {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: config.region
	},
	stackName: 'shepherd-infra-stack',
	description: 'shepherd main infrastructure stack. network, rds, etc.',
	config,
})

new ServicesStack(app, 'ServicesStack', {
	env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
	stackName: 'shepherd-services',
	description: 'Shepherd services stack: ecs, lambdas, etc',
	config,
})


