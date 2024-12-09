console.log(`process.env.SLACK_WEBHOOK ${process.env.SLACK_WEBHOOK}`)
console.log(`process.env.SLACK_POSITIVE ${process.env.SLACK_POSITIVE}`)
console.log(`process.env.SLACK_PROBE ${process.env.SLACK_PROBE}`)

// import './checkBlocking/index-cron'
import express from 'express'
import { slackLog } from '../../../libs/utils/slackLog'
import { ipAllowMiddleware } from './ipAllowLists'
import { network_EXXX_codes } from '../../../libs/constants'
import { Socket } from 'net'
import { txsTableNames } from './tablenames'
import { GetListPath, getETag, getList, prefetchLists } from './lists'
import { getRecords } from './blacklist' //legacy


const prefix = 'webserver'
const app = express()
const port = 80

// app.use(cors())

prefetchLists()

app.get('/', async (req, res) => {
	res.setHeader('Content-Type', 'text/plain')
	res.write('Webserver operational. v3.\n\n\n')
	res.status(200).end()
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

txsTableNames().then((tablenames) => {
	tablenames.forEach((tablename) => {
		const routepath = tablename.replace('_txs', '')
		const routeTxids = `/${routepath}/txids.txt`
		app.get(routeTxids, ipAllowMiddleware('txids'), async (req, res) => {
			res.setHeader('Content-Type', 'text/plain')
			await getRecords(res, 'txids', tablename)
			res.status(200).end()
		})
		const routeRanges = `/${routepath}/ranges.txt`
		app.get(routeRanges, ipAllowMiddleware('ranges'), async (req, res) => {
			res.setHeader('Content-Type', 'text/plain')
			await getRecords(res, 'ranges', tablename)
			res.status(200).end()
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
 * catch malformed client requests.
 * useful for testing: curl -v -X POST -H 'content-length: 3' --data-raw 'aaaa' http://localhost
 */
server.on('clientError', (e: Error & { code: string }, socket: Socket) => {

	slackLog(prefix, 'express-clientError', `${e.name} (${e.code}) : ${e.message}. socket.writable=${socket.writable} \n${e.stack}`)
	//debug
	console.log('Socket:', {
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
	})

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


