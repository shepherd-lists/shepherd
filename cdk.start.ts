#!/usr/bin/env npx tsx

import { program } from 'commander'

program
	.name('shepherd launcher')
	.option('-c, --config <config-name>', '(required) config name. e.g. dev for `config.dev.ts`')
	.option('-h, --help', 'get help')
	.option('-s, --stack <stack>', 'single stack name, if omitted, all stacks will be operated on')
	.argument('[synth|bootstrap|ls|deploy|destroy|etc]', 'cdk command to run')



program.parse(process.argv)

const options = program.opts()
if (options.help || !options.config) {
	program.help()
}



