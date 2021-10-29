require('dotenv').config() //first line of entrypoint
import express from 'express'
import { logger } from '../utils/logger'
import { getBlacklist, getBlacklistTestOnly } from './blacklist'


const app = express()
const port = 80

// app.use(cors())

app.get('/', (req, res)=> {
	res.status(200).send('Webserver operational.')
})

app.get('/blacklist.txt', async(req, res)=> {
	res.setHeader('Content-Type', 'text/plain')
	const text = await getBlacklist(true)
	res.send(text)
})

app.get('/whitelist.txt', async(req, res)=> {
	res.setHeader('Content-Type', 'text/plain')
	const text = await getBlacklist(false)
	res.send(text)
})

app.get('/nocache-testonly.html', async(req, res)=> {
	res.setHeader('Content-Type', 'text/html')
	const html = await getBlacklistTestOnly(true)
	res.send(html)
})


app.listen(port, ()=> logger(`started on http://localhost:${port}`))
