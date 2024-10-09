import express from 'express'
import { Socket } from 'net'
import { slackLog } from '../../../libs/utils/slackLog'
import { network_EXXX_codes } from '../../../libs/constants'
import { pluginResultHandler } from './pluginResultHandler'
import './done-records' //self starting


const prefix = 'http-api'
const app = express()
const port = 84

app.use(express.json())

app.get('/', (req, res) => {
	res.status(200).send('API listener operational.\n')
})


app.post('/postupdate', async (req, res) => {
	req.resume()
	const body = req.body
	try {

		/** this is where it all happens */
		const ref = await pluginResultHandler(body)

		console.log(`${pluginResultHandler.name} returned ${ref}, responding 200 OK`)
		res.sendStatus(200)
	} catch (err: unknown) {
		const e = err as Error & { code?: string }
		console.error(prefix, body?.txid, 'Error. Request body:', JSON.stringify(req.body), 'Error:', e)
		if (e instanceof TypeError) {
			res.setHeader('Content-Type', 'text/plain')
			res.status(400).send(e.message)
			return
		}
		if (e.message === 'Could not update database') {
			res.setHeader('Content-Type', 'text/plain')
			res.status(406).send(e.message)
			return
		}
		slackLog(body?.txid, 'UNHANDLED Error =>', `${e.name} (${e.code}) : ${e.message}`)
		console.log(e)
		res.sendStatus(500)
	}
})

export const server = app.listen(port, () => {
	/** we're getting "clientError" 400 sent back to client. adjusting this timeout */
	server.headersTimeout = 120_000 //default (nodejs) appears to be 60_000 currnently

	console.info(`started on http://localhost:${port}`)
	//debug
	console.log('Server settings:',
		{
			timeout: server.timeout,
			requestTimeout: server.requestTimeout,
			headersTimeout: server.headersTimeout,
			keepAliveTimeout: server.keepAliveTimeout,
			//@ts-expect-error the following are not supposed to exist on Server
			connectionsCheckingInterval: server.connectionsCheckingInterval, allowHalfOpen: server.allowHalfOpen, pauseOnConnect: server.pauseOnConnect,
			//@ts-expect-error the following are not supposed to exist on Server
			keepAlive: server.keepAlive, keepAliveInitialDelay: server.keepAliveInitialDelay, httpAllowHalfOpen: server.httpAllowHalfOpen,
			maxHeadersCount: server.maxHeadersCount, maxRequestsPerSocket: server.maxRequestsPerSocket,
		}
	)
})

/** catch malformed client requests for example, might emit for server issues also though */
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

	//make sure connection still open
	if (
		(e.code && network_EXXX_codes.includes(e.code))
		|| !socket.writable) {
		return
	}
	if (e.code === 'ERR_HTTP_REQUEST_TIMEOUT') {
		slackLog('express-clientError', `ERR_HTTP_REQUEST_TIMEOUT. socket.writable=${socket.writable}. NOT CLOSING THE CONNECTION! Check these logs.`)
		return
	}
	socket.end('HTTP/1.1 400 Bad Request\r\n\r\n') //is this confusing? should we send a 500 sometimes?
})

server.on('error', (e: Error & { code?: string }) => {
	slackLog('express-error', `${e.name} (${e.code}) : ${e.message}. \n${e.stack}`)
})

