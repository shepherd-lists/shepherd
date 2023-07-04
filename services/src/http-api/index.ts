import express from 'express'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { slackLogger } from '../common/utils/slackLogger'
import { network_EXXX_codes } from '../common/constants'
import { pluginResultHandler } from './pluginResultHandler'
import { doneInit } from './done-records'

/** call init early */
doneInit()

const prefix = 'http-api'
const app = express()
const port = 84

app.use(express.json())

app.get('/', (req, res)=> {
	res.status(200).send('API listener operational.')
})


app.post('/postupdate', async(req, res)=>{
	req.resume()
	const body = req.body
	try{

		/** this is where it all happens */
		await pluginResultHandler(body)

		res.sendStatus(200)
	}catch(e:any){
		logger(prefix, 'Error. Request body:', JSON.stringify(req.body))
		if(e instanceof TypeError){
			res.setHeader('Content-Type', 'text/plain')
			res.status(400).send(e.message)
			return;
		}
		if(e.message === 'Could not update database'){
			res.setHeader('Content-Type', 'text/plain')
			res.status(406).send(e.message)
			return;
		}
		logger(prefix, 'UNHANDLED Error =>', `${e.name} (${e.code}) : ${e.message}`)
		slackLogger('UNHANDLED Error =>', `${e.name} (${e.code}) : ${e.message}`)
		console.log(e)
		res.sendStatus(500)
	}
})

export const server = app.listen(port, ()=> logger(`started on http://localhost:${port}`))

/** catch malformed client requests */
server.on('clientError', (e: any, socket)=> {
	logger(`express-clientError`, `${e.name} (${e.code}) : ${e.message}. socket.writable=${socket.writable} \n${e.stack}`)
	//make sure connection still open
	if(
		( e.code && network_EXXX_codes.includes(e.code) )
		|| !socket.writable) {
    return;
  }
	socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

server.on('error', (e: any)=> {
	logger(`express-error`, `${e.name} (${e.code}) : ${e.message}. \n${e.stack}`)
})

