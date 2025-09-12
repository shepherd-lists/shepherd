console.log(`process.env.SLACK_WEBHOOK ${process.env.SLACK_WEBHOOK}`)
console.log(`process.env.SLACK_PROBE ${process.env.SLACK_PROBE}`)

// import './checkBlocking/index-cron'
import express, { ErrorRequestHandler } from 'express'
import { slackLog } from '../../../libs/utils/slackLog'
import { ipAllowMiddleware } from './ipAllowLists'
import { network_EXXX_codes } from '../../../libs/constants'
import { Socket } from 'net'
import { addonTxsTableNames } from '../../../libs/utils/addon-tablenames'
import { GetListPath, getETag, getList, prefetchLists } from './lists'
import { networkInterfaces } from 'os'


const prefix = 'webserver'
const app = express()
const port = 80

prefetchLists()

// app.use(cors())


/** track connections with both ALB IP and real client IP */
const connectionIPs = new Map<Socket, {
	alb: string
	forwarded: string | null
}>()

// Middleware to capture real client IP from x-forwarded-for
app.use((req, res, next) => {
	const forwarded = req.headers['x-forwarded-for'] as string || 'unknown'
	const socket = req.socket

	// Update our connection tracking with the real client IP
	if (socket && connectionIPs.has(socket)) {
		const cnnIPs = connectionIPs.get(socket)!
		cnnIPs.forwarded = forwarded
	}

	console.log(JSON.stringify({
		eventType: 'request',
		timestamp: new Date().toISOString(),
		alb: connectionIPs.get(socket)?.alb || 'unknown',
		forwarded,
		path: req.path,
		method: req.method
	}))

	next()
})

app.get('/robots.txt', (req, res) => {
	res.type('text/plain')
	res.send('User-agent: *\nDisallow: /\n')
})


app.get('/health-check', async (req, res) => {
	res.sendStatus(200)
})

app.get('/', async (req, res) => {
	res.sendStatus(404)
})

app.get('/addresses.txt', ipAllowMiddleware('txids'), async (req, res) => {
	try {
		res.setHeader('Content-Type', 'text/plain')
		await getList(res, '/addresses.txt')
		res.status(200).end()
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(prefix, '/addresses.txt', `❌ ERROR retrieving! ${e.name}:${e.message}.`)
		res.status(500).send('internal server error\n')
	}
})

addonTxsTableNames().then((tablenames) => {
	tablenames.forEach((tablename) => {
		const routepath = tablename.replace('_txs', '')

		const routeTxids: GetListPath = `/${routepath}/txids.txt`
		app.head(routeTxids, ipAllowMiddleware('txids'), async (req, res) => {
			res.setHeader('eTag', await getETag(routeTxids))
			res.sendStatus(200)
		})
		app.get(routeTxids, ipAllowMiddleware('txids'), async (req, res) => {
			try {
				res.setHeader('Content-Type', 'text/plain')
				await getList(res, routeTxids)
				res.status(200).end()
			} catch (err) {
				const e = err as Error
				await slackLog(prefix, routeTxids, `❌ ERROR retrieving! ${e.name}:${e.message}.`)
				res.status(500).send('internal server error\n')
			}
		})

		const routeRanges: GetListPath = `/${routepath}/ranges.txt`
		app.head(routeRanges, ipAllowMiddleware('ranges'), async (req, res) => {
			res.setHeader('eTag', await getETag(routeRanges))
			res.sendStatus(200)
		})
		app.get(routeRanges, ipAllowMiddleware('ranges'), async (req, res) => {
			try {
				res.setHeader('Content-Type', 'text/plain')
				await getList(res, routeRanges)
				res.status(200).end()
			} catch (err) {
				const e = err as Error
				await slackLog(prefix, routeRanges, `❌ ERROR retrieving! ${e.name}:${e.message}.`)
				res.status(500).send('internal server error\n')
			}
		})
		console.log(JSON.stringify({ tablename, routepath, routeTxids, routeRanges }))
	})
})

app.head('/blacklist.txt', ipAllowMiddleware('txids'), async (req, res) => {
	res.setHeader('eTag', await getETag(req.path as GetListPath))
	res.sendStatus(200)
})

app.get('/blacklist.txt', ipAllowMiddleware('txids'), async (req, res) => {
	res.setHeader('Content-Type', 'text/plain')
	try {
		await getList(res, '/blacklist.txt')
		res.status(200).end()
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(prefix, '/blacklist.txt', `❌ ERROR retrieving! ${e.name}:${e.message}.`)
		res.status(500).send('internal server error\n')
	}
})

app.head('/rangelist.txt', ipAllowMiddleware('ranges'), async (req, res) => {
	res.setHeader('eTag', await getETag(req.path as GetListPath))
	res.sendStatus(200)
})

app.get('/rangelist.txt', ipAllowMiddleware('ranges'), async (req, res) => {
	const path = req.path as GetListPath
	res.setHeader('Content-Type', 'text/plain')
	try {
		await getList(res, path)
		res.status(200).end()
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(prefix, path, `❌ ERROR retrieving! ${e.name}:${e.message}.`)
		res.status(500).send('internal server error\n')
	}
})

/** used by shep-v */
app.head(/^\/range(flagged|owners).txt$/, ipAllowMiddleware('ranges'), async (req, res) => {
	res.setHeader('eTag', await getETag(req.path as GetListPath))
	res.sendStatus(200)
})
app.get(/^\/range(flagged|owners).txt$/, ipAllowMiddleware('ranges'), async (req, res) => {
	const path = req.path as GetListPath
	res.setHeader('Content-Type', 'text/plain')
	try {
		await getList(res, path)
		res.status(200).end()
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(prefix, path, `❌ ERROR retrieving! ${e.name}:${e.message}.`)
		res.status(500).send('internal server error\n')
	}
})

const server = app.listen(port, () => console.info(`webserver started on http://localhost:${port}`))


/**
 *  
 * error logging 
 * 
 * */

const webserverPrivateIPs = () => {
	const ips: string[] = []
	const nets = networkInterfaces()
	for (const name of Object.keys(nets)) {
		for (const net of nets[name]!) {
			// Skip internal (i.e. 127.0.0.1) and non-ipv4 addresses
			if (net.family === 'IPv4' && !net.internal) {
				ips.push(net.address)
			}
		}
	}
	return ips.length ? ips.join(', ') : 'unknown'
}
const targetIPs = webserverPrivateIPs()

server.on('connection', (socket: Socket) => {
	const alb = socket.remoteAddress || 'unknown'
	connectionIPs.set(socket, {
		alb,
		forwarded: null // Will be updated when we get x-forwarded-for
	})

	// Clean up when socket closes
	socket.on('close', () => {
		connectionIPs.delete(socket)
	})
	socket.on('error', (e: Error) => {
		connectionIPs.delete(socket)
	})
})

/**
 * catch malformed client requests.
 * useful for testing: curl -v -X POST -H 'content-length: 3' --data-raw 'aaaa' http://localhost
 */
server.on('clientError', (e: Error & { code: string }, socket: Socket) => {
	const cnnIPs = connectionIPs.get(socket)
	const alb = cnnIPs?.alb || socket.remoteAddress || 'unknown'
	const forwarded = cnnIPs?.forwarded || 'unknown'

	console.error(prefix, 'clientError', `ALB: ${alb} → Real Client: ${forwarded} → Webserver: ${targetIPs} - ${e.name} (${e.code}) : ${e.message}. socket.writable=${socket.writable} \n${e.stack}`)
	slackLog(prefix, 'clientError', `Real Client: ${forwarded} - (${e.code}) ${String(e)}. socket.writable=${socket.writable}`)

	//write object for CW querying
	console.error(JSON.stringify({
		eventType: 'clientError',
		timestamp: new Date().toISOString(),
		alb,
		forwarded,
		targetIPs,
		code: e.code,
		message: e.message,
		stack: e.stack,
		timeout: socket.timeout,
		allowHalfOpen: socket.allowHalfOpen,
		destroyed: socket.destroyed,
		remoteAddress: socket.remoteAddress,
		remoteFamily: socket.remoteFamily,
		remotePort: socket.remotePort,
		bytesRead: socket.bytesRead,
		bytesWritten: socket.bytesWritten,
		connecting: socket.connecting,
		readyState: socket.readyState,
		closed: socket.closed,
		errored: socket.errored,
		pending: socket.pending,
		readable: socket.readable,
		writable: socket.writable,
	}))

	if (e.code === 'HPE_INVALID_METHOD' || e.code === 'HPE_INVALID_HEADER_TOKEN') {
		console.error('express-clientError', `malformed request. ${e.name} (${e.code}) : ${e.message}. Closing the socket with HTTP/1.1 400 Bad Request.`)
		return socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
	}

	//make sure connection still open
	if (
		(e.code && network_EXXX_codes.includes(e.code))
		|| !socket.writable) {
		return
	}

	socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})


