console.log(`process.env.SLACK_WEBHOOK ${process.env.SLACK_WEBHOOK}`)
console.log(`process.env.SLACK_POSITIVE ${process.env.SLACK_POSITIVE}`)
console.log(`process.env.SLACK_PROBE ${process.env.SLACK_PROBE}`)

import './checkBlocking/index-cron'
import express from 'express'
import { slackLog } from '../../../libs/utils/slackLog'
import { ipAllowRangesMiddleware, ipAllowTxidsMiddleware } from './ipAllowLists'
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

app.get('/addresses.txt', ipAllowTxidsMiddleware, async (req, res) => {
	try {
		res.setHeader('Content-Type', 'text/plain')
		await getList(res, '/addresses.txt')
		res.status(200).end()
	} catch (err: unknown) {
		const e = err as Error
		await slackLog('/addresses.txt', `❌ ERROR retrieving! ${e.name}:${e.message}.`)
		res.status(500).send('internal server error\n')
	}
})

/** [legacy remove] dynamically generate routes from ADDONS tablenames */
txsTableNames().then((tablenames) => {
	tablenames.forEach((tablename) => {
		const routepath = tablename.replace('_txs', '')
		const routeTxids = `/${routepath}/txids.txt`
		app.get(routeTxids, ipAllowTxidsMiddleware, async (req, res) => {
			res.setHeader('Content-Type', 'text/plain')
			await getRecords(res, 'txids', tablename)
			res.status(200).end()
		})
		const routeRanges = `/${routepath}/ranges.txt`
		app.get(routeRanges, ipAllowRangesMiddleware, async (req, res) => {
			res.setHeader('Content-Type', 'text/plain')
			await getRecords(res, 'ranges', tablename)
			res.status(200).end()
		})
		console.log(JSON.stringify({ tablename, routepath, routeTxids, routeRanges }))
	})
})

app.get('/blacklist.txt', ipAllowTxidsMiddleware, async (req, res) => {
	res.setHeader('Content-Type', 'text/plain')
	try {
		await getList(res, '/blacklist.txt')
		res.status(200).end()
	} catch (err: unknown) {
		const e = err as Error
		await slackLog('/blacklist.txt', `❌ ERROR retrieving! ${e.name}:${e.message}.`)
		res.status(500).send('internal server error\n')
	}
})

app.head(/^\/range(list|flagged|owners).txt$/, ipAllowRangesMiddleware, async (req, res) => {
	res.setHeader('eTag', getETag(req.path as GetListPath))
	res.sendStatus(200)
})

app.get(/^\/range(list|flagged|owners).txt$/, ipAllowRangesMiddleware, async (req, res) => {
	const path = req.path as GetListPath
	res.setHeader('Content-Type', 'text/plain')
	try {
		await getList(res, path)
		res.status(200).end()
	} catch (err: unknown) {
		const e = err as Error
		await slackLog(path, `❌ ERROR retrieving! ${e.name}:${e.message}.`)
		res.status(500).send('internal server error\n')
	}
})


const server = app.listen(port, () => console.info(`webserver started on http://localhost:${port}`))

/**
 * catch malformed client requests.
 * useful for testing: curl -v -X POST -H 'content-length: 3' --data-raw 'aaaa' http://localhost
 */
server.on('clientError', (e: Error & { code: string }, socket: Socket) => {

	console.error('express-clientError', `${e.name} (${e.code}) : ${e.message}. socket.writable=${socket.writable} \n${e.stack}`)
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


