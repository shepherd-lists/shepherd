require('dotenv').config() //first line of entrypoint
import express from 'express'
import { logger } from '../common/utils/logger'
import { getBlacklist, getBlacklistTestOnly, getPerfHistory, getStatsTestOnly } from './blacklist'
import si from 'systeminformation'
import './perf-cron' //starts automatically

const app = express()
const port = 80

// app.use(cors())

app.get('/', async(req, res)=> {
	res.setHeader('Content-Type', 'text/plain')
	const text = JSON.stringify(await si.osInfo())
	res.status(200).send('Webserver operational.\n\n\n' + text)
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

app.get('/nocache-stats.html', async(req, res)=> {
	res.setHeader('Content-Type', 'text/html')
	await getStatsTestOnly(res)
	res.end()
})

app.get('/perf',async (req, res) => {
	res.setHeader('Content-Type', 'text/html')
	const html = await getPerfHistory()
	res.send(html) 
})

app.listen(port, ()=> logger(`started on http://localhost:${port}`))


