#!/usr/bin/env -S npx tsx
import { existsSync, writeFileSync } from 'fs'

/** ensure `shepherd.config.json` exists */
const configFile = `${__dirname}/shepherd.config.json`
if (!existsSync(configFile)) {
	console.log(`${configFile} not found. creating default...`)
	writeFileSync(configFile, JSON.stringify({
		plugins: ['shepherd-plugin-nsfw@latest'],
		lowmem: false
	}, null, 2) + '\n')
} else {
	console.info('shepherd.config.json found.')
}
