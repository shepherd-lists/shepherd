#!/usr/bin/env -S npx tsx

import { Config } from './Config'
import { program } from 'commander'
import { basename, dirname } from 'path'
import col from 'ansi-colors'
import { execSync } from 'child_process'



/** useful functions */
const __dirname = dirname(new URL(import.meta.url).pathname)
const __filename = basename(new URL(import.meta.url).pathname)
const logHeading = (msg: string) => console.info(col.bgYellow.black(msg))

/** use commander to handle script inputs */
program
	.name(__filename)
	.description('wrapper for cdk that loads config. cdk options can be included after a solo `--`')
	.option('-c, --config <config-name>', '(required) config name. e.g. dev for `config.dev.ts`')
	.option('-h, --help', 'get help')
	// .option('-s, --stack <stack>', 'single stack name, if omitted, all stacks will be operated on')
	.argument('[cdk-comand]', 'the cdk command to run, e.g. synth, bootstrap, ls, deploy, destroy, etc.')
	.argument('[stacks...]', 'the stacks to run the command on')

program.parse(process.argv)
console.debug(program.args)

const options = program.opts()
if (options.help || !options.config) {
	program.help()
}


logHeading(`import config...`)
const config: Config = (await import(`${__dirname}/config.${options.config as string}`)).config
console.info(config)


logHeading(`exec cdk commands on stacks... (${config.region})`)
let cdkCommand = `npx cdk -a 'npx tsx app.ts ${options.config}' ${program.args.join(' ')}`

console.debug(`executing: ${cdkCommand}`)

execSync(cdkCommand, {
	encoding: 'utf8',
	stdio: 'inherit',
})


