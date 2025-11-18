import { App } from 'aws-cdk-lib'
import { Config } from './Config'
import { InfraStack } from './infra/stack'

const configName = process.argv[2]

const config: Config = (await import(`./config.${configName}.ts`)).config
if(!config) throw new Error(`config not set. configName: ${configName}`)

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


/** addons. these get imported a little differently as they don't use classes. */
for(const addon of config.addons){
	const { createStack } = await import(`./addons/${addon}/infra/stack`)
	createStack(app, config)
}



