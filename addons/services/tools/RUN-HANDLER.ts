/**
 * Manually run a lambda handler (fnInitLists or fnTemp).
 *
 * Usage:
 *   npx tsx tools/run-handler.ts fnInitLists
 *   npx tsx tools/run-handler.ts fnTemp
 *
 * Required env vars: DB_HOST, LISTS_BUCKET, REDIS_HOST (+ AWS S3 credentials)
 */
import 'dotenv/config'
import { handler as fnInitLists } from '../lambdas/fnInitLists/index'
import { handler as fnTemp } from '../lambdas/fnTemp/index'
//make it stop
import pgClient from '../libs/utils/pgClient'
import { redis } from '../libs/utils/redis-state'



const handlers: Record<string, (event: any) => Promise<any>> = {
	fnInitLists,
	fnTemp,
}

const name = process.argv[2]
if (!name || !handlers[name]) {
	console.error(`Usage: npx tsx tools/run-handler.ts <${Object.keys(handlers).join('|')}>`)
	process.exit(1)
}

console.info(`Running ${name}...`)
const t0 = Date.now()
try {
	const result = await handlers[name]({})
	console.info(`${name} completed in ${((Date.now() - t0) / 1000).toFixed(1)}s. Result:`, result)
} catch (e) {
	console.error(`${name} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e)
} finally {
	await pgClient.end()
	redis.disconnect()
}
