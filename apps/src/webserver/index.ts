require('dotenv').config() //first line of entrypoint
import express from 'express'
import { logger } from '../common/utils/logger'
import { getBlacklist, getPerfHistory, getRangelist, getStatsTestOnly } from './blacklist'
import si from 'systeminformation'
import './perf-cron' //starts automatically

const app = express()
const port = 80

// app.use(cors())

console.log('process.env.WHITELIST',process.env.WHITELIST)
const accessList: string[] = JSON.parse(process.env.WHITELIST || '[]')
console.log(`accessList (WHITELIST) for '/blacklist.txt' access`, accessList)

const ipWhitelisted = (ip: string)=>{
	// convert from `::ffff:192.0.0.1` => `192.0.0.1`
	if(ip.startsWith("::ffff:")){
    ip = ip.substring(7)
	}
	return accessList.includes(ip)
}


app.get('/', async(req, res)=> {
	res.setHeader('Content-Type', 'text/plain')
	res.write('Webserver operational.\n\n\n')

	if(process.env.WHITELIST){
		const ip = req.headers['x-forwarded-for'] as string || 'undefined'
		res.write(`your ip is ${ip}\n`)
		res.write(`whitelisted: ${ipWhitelisted(ip)}\n`)
	}else{
		res.write('$WHITELIST is not defined')
	}
	res.write('\n\n')
	
	const text = JSON.stringify(await si.osInfo())
	res.write('\n\n\n' + text)

	res.status(200).end()
})

app.get('/blacklist.txt', async(req, res)=> {
	//if $WHITELIST not defined we let everyone access
	if(process.env.WHITELIST){
		const ip = req.headers['x-forwarded-for'] as string || 'undefined'
		if(!ipWhitelisted(ip)){
			return res.status(403).send('403 Forbidden')
		}
	}

	res.setHeader('Content-Type', 'text/plain')
	await getBlacklist(res)
	res.status(200).end()
})

app.get('/rangelist.txt', async(req, res)=> {
	res.setHeader('Content-Type', 'text/plain')
	await getRangelist(res)
	res.status(200).end()
})

app.get('/nocache-stats.html', async(req, res)=> {
	res.setHeader('Content-Type', 'text/html')
	await getStatsTestOnly(res)
	res.end()
})

app.get('/perf',async (req, res) => {
	res.setHeader('Content-Type', 'text/html')
	await getPerfHistory(res)
	res.status(200).end() 
})

app.listen(port, ()=> logger(`started on http://localhost:${port}`))


