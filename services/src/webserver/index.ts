console.log(`process.env.SLACK_WEBHOOK ${process.env.SLACK_WEBHOOK}`)
console.log(`process.env.SLACK_POSITIVE ${process.env.SLACK_POSITIVE}`)
console.log(`process.env.SLACK_PROBE ${process.env.SLACK_PROBE}`)

import express from 'express'
import { logger } from '../common/utils/logger'
import { ipAllowBlacklist, ipAllowRangelist, ipAllowRangesMiddleware, ipAllowTxidsMiddleware } from './ipAllowLists'
import { getBlacklist, getRangelist, getRecords } from './blacklist'
import { getPerfHistory, getDevStats } from './metrics'
import si from 'systeminformation'
// import './perf-cron' //starts automatically
import './checkBlocking/checkBlocking-timer' //starts automatically
import { network_EXXX_codes } from '../common/constants'
import { Socket } from 'net'
import { txsTableNames } from './tablenames'

const prefix = 'webserver'
const app = express()
const port = 80

// app.use(cors())



app.get('/', async (req, res) => {
	res.setHeader('Content-Type', 'text/plain')
	res.write('Webserver operational.\n\n\n')

	const ip = req.headers['x-forwarded-for'] as string || 'undefined'
	res.write(`your ip is ${ip}\n`)
	if(process.env.BLACKLIST_ALLOWED){
		res.write(`access blacklist: ${ipAllowBlacklist(ip)}\n`)
	}else{
		res.write('$BLACKLIST_ALLOWED is not defined\n')
	}
	if(process.env.RANGELIST_ALLOWED){
		res.write(`access rangelist: ${ipAllowRangelist(ip)}\n`)
	}else{
		res.write('$RANGELIST_ALLOWED is not defined\n')
	}
	res.write('\n\n')

	const text = JSON.stringify(await si.osInfo())
	res.write('\n\n\n' + text)

	res.status(200).end()
})

/** dynamically generate routes from PLUGINS tablenames */
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
		console.log(JSON.stringify({tablename, routepath, routeTxids, routeRanges }))
	})
})

app.get('/blacklist.txt', ipAllowTxidsMiddleware, async (req, res) => {
	res.setHeader('Content-Type', 'text/plain')
	await getBlacklist(res)
	res.status(200).end()
})

app.get('/rangelist.txt', ipAllowRangesMiddleware, async (req, res) => {
	res.setHeader('Content-Type', 'text/plain')
	await getRangelist(res)
	res.status(200).end()
})

app.get('/stats', async (req, res) => {
	res.writeHead(200, {
		'Content-Type': 'text/html',
		'Cache-Control': 'no-cache',
		'Connection': 'keep-alive',
		'Keep-Alive': 'timeout=60, max=1',
	})
	res.flushHeaders()
	await getDevStats(res)
	res.end()
})


const server = app.listen(port, () => logger(`started on http://localhost:${port}`))

/**
 * catch malformed client requests.
 * useful for testing: curl -v -X POST -H 'content-length: 3' --data-raw 'aaaa' http://localhost
 */
server.on('clientError', (e: Error & {code: string}, socket: Socket)=> {

	logger('express-clientError', `${e.name} (${e.code}) : ${e.message}. socket.writable=${socket.writable} \n${e.stack}`)
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

	if(e.code === 'HPE_INVALID_METHOD' || e.code === 'HPE_INVALID_HEADER_TOKEN'){
		logger('express-clientError', `malformed request. ${e.name} (${e.code}) : ${e.message}. Closing the socket with HTTP/1.1 400 Bad Request.`)
		return socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
	}

	//make sure connection still open
	if(
		( e.code && network_EXXX_codes.includes(e.code) )
		|| !socket.writable){
		return
	}

	socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})


