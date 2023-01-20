import express from 'express'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { getBlacklist, getRangelist } from './blacklist'
import { getPerfHistory, getStatsTestOnly } from './metrics'
import si from 'systeminformation'
import './perf-cron' //starts automatically
import './checkBlocking/checkBlocking-timer' //starts automatically
import { slackLogger } from '../common/utils/slackLogger'
import { network_EXXX_codes } from '../common/constants'

const prefix = 'webserver'
const app = express()
const port = 80

// app.use(cors())

/* load the IP access lists */
const accessBlacklist: string[] = JSON.parse(process.env.BLACKLIST_ALLOWED || '[]')
logger(prefix, `accessList (BLACKLIST_ALLOWED) for '/blacklist.txt' access`, accessBlacklist)
const accessRangelist: string[] = JSON.parse(process.env.RANGELIST_ALLOWED || '[]')
logger(prefix, `accessList (RANGELIST_ALLOWED) for '/rangelist.txt' access`, accessRangelist)

const ipAllowBlacklist = (ip: string) => {
	/* convert from `::ffff:192.0.0.1` => `192.0.0.1` */
	if (ip.startsWith("::ffff:")) {
		ip = ip.substring(7)
	}
	return accessBlacklist.includes(ip)
}
const ipAllowRangelist = (ip: string) => {
	if (ip.startsWith("::ffff:")) {
		ip = ip.substring(7)
	}
	return accessRangelist.includes(ip)
}



app.get('/', async (req, res) => {
	res.setHeader('Content-Type', 'text/plain')
	res.write('Webserver operational.\n\n\n')

	const ip = req.headers['x-forwarded-for'] as string || 'undefined'
	res.write(`your ip is ${ip}\n`)
	if (process.env.BLACKLIST_ALLOWED) {
		res.write(`access blacklist: ${ipAllowBlacklist(ip)}\n`)
	} else {
		res.write('$BLACKLIST_ALLOWED is not defined\n')
	}
	if (process.env.RANGELIST_ALLOWED) {
		res.write(`access rangelist: ${ipAllowRangelist(ip)}\n`)
	} else {
		res.write('$RANGELIST_ALLOWED is not defined\n')
	}
	res.write('\n\n')

	const text = JSON.stringify(await si.osInfo())
	res.write('\n\n\n' + text)

	res.status(200).end()
})

app.get('/blacklist.txt', async (req, res) => {
	/* if $BLACKLIST_ALLOWED not defined we let everyone access */
	if (process.env.BLACKLIST_ALLOWED) {
		const ip = req.headers['x-forwarded-for'] as string || 'undefined'
		if (!ipAllowBlacklist(ip)) {
			logger('blacklist', `ip '${ip}' denied access`)
			return res.status(403).send('403 Forbidden')
		}
		logger('blacklist', `ip '${ip}' access granted`)
	}

	res.setHeader('Content-Type', 'text/plain')
	await getBlacklist(res)
	res.status(200).end()
})

app.get('/rangelist.txt', async (req, res) => {
	/* if $RANGELIST_ALLOWED not defined we let everyone access */
	if (process.env.RANGELIST_ALLOWED) {
		const ip = req.headers['x-forwarded-for'] as string || 'undefined'
		if (!ipAllowRangelist(ip)) {
			logger('rangelist', `ip '${ip}' denied access`)
			return res.status(403).send('403 Forbidden')
		}
		logger('rangelist', `ip '${ip}' access granted`)
	}

	res.setHeader('Content-Type', 'text/plain')
	await getRangelist(res)
	res.status(200).end()
})

app.get('/nocache-stats.html', async (req, res) => {
	res.setHeader('Content-Type', 'text/html')
	await getStatsTestOnly(res)
	res.end()
})

app.get('/perf', async (req, res) => {
	res.setHeader('Content-Type', 'text/html')
	await getPerfHistory(res)
	res.status(200).end()
})

const server = app.listen(port, () => logger(`started on http://localhost:${port}`))

/**
 * catch malformed client requests.
 * useful for testing: curl -v -X POST -H 'content-length: 3' --data-raw 'aaaa' http://localhost
 */
server.on('clientError', (e: any, socket)=> {

	slackLogger(`express-clientError`, `${e.name} (${e.code}) : ${e.message}.`)
	logger(`express-clientError`, `${e.name} (${e.code}) : ${e.message}. \n${e.stack}`)

	//make sure connection still open
	if(
		( e.code && network_EXXX_codes.includes(e.code) )
		|| !socket.writable) {
    return;
  }

	socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})


