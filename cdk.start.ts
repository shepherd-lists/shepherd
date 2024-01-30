#!/usr/bin/env -S npx tsx

import { Config } from './Config'
import { program } from 'commander'
import { basename, dirname } from 'path'
import col from 'ansi-colors'
import { App } from 'aws-cdk-lib'
import { InfraStack } from './infra/stack'

/** use commander to handle script inputs */
program
	.name('shepherd launcher')
	.description('wrapper for cdk that loads config. cdk options can be included after a solo `--`')
	.option('-c, --config <config-name>', '(required) config name. e.g. dev for `config.dev.ts`')
	.option('-h, --help', 'get help')
	// .option('-s, --stack <stack>', 'single stack name, if omitted, all stacks will be operated on')
	.argument('[cdk-comand]', 'the cdk command to run, e.g. synth, bootstrap, ls, deploy, destroy, etc.')
	.argument('[stacks...]', 'the stacks to run the command on')

program.parse(process.argv)

const options = program.opts()
if (options.help || !options.config) {
	program.help()
}

/** useful functions */
const __dirname = dirname(new URL(import.meta.url).pathname)
const __filename = basename(new URL(import.meta.url).pathname)
const logHeading = (msg: string) => console.info(col.bgYellow.black(msg))


logHeading(`import config...`)
const config: Config = (await import(`${__dirname}/config.${options.config as string}`)).config
console.info(config)


/** use root cdk project that will import the various stacks into it */
logHeading(`import stacks... (${config.region})`)
const app = new App()

logHeading(`--import infra stack...${config.region}`)
new InfraStack(app, 'Infra', {
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: config.region
	},
	stackName: 'shepherd-infra-stack',
	description: 'shepherd main infrastructure stack. network, rds, etc.',
	config,
})
