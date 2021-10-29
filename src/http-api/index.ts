require('dotenv').config()
import express from 'express'
import { dbCorruptDataConfirmed, dbCorruptDataMaybe, dbNoop, dbOversizedPngFound, dbPartialImageFound, dbUnsupportedMimeType, updateDb } from '../rating/db-update-txs'
import { FilterErrorResult, FilterResult } from '../shepherd-plugin-interfaces'
import { logger } from '../utils/logger'
import { slackLogger } from '../utils/slackLogger'

const prefix = 'http-api'
const app = express()
const port = 84

app.use(express.json())

app.get('/', (req, res)=> {
	res.status(200).send('API listener operational.')
})

app.post('/postupdate', async(req, res)=>{
	try{
		console.log('request body:', JSON.stringify(req.body))
		await pluginResultHandler(req.body)
		res.sendStatus(200)
	}catch(e:any){
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
		logger('UNHANDLED Error =>', `${e.name} (${e.code}) : ${e.message}`)
		slackLogger('UNHANDLED Error =>', `${e.name} (${e.code}) : ${e.message}`)
		console.log(e)
		res.sendStatus(500)
	}
})

app.listen(port, ()=> logger(`started on http://localhost:${port}`))

interface APIFilterResult {
	txid: string
	result: FilterResult | FilterErrorResult
}

const pluginResultHandler = async(body: APIFilterResult)=>{
	const txid = body.txid
	const result = body.result
	
	if((typeof txid !== 'string') || txid.length !== 43){
		throw new TypeError('txid is not defined correctly')
	}

	if(result.flagged !== undefined){
		const res = await updateDb(txid, {
			flagged: result.flagged,
		})
		if(res !== txid){
			throw new Error('Could not update database')
		}
	}else{
		switch (result.data_reason) {
			case 'corrupt-maybe':
				await dbCorruptDataMaybe(txid)
				break;
			case 'corrupt':
				await dbCorruptDataConfirmed(txid)
				break;
			case 'oversized':
				await dbOversizedPngFound(txid)
				break;
			case 'partial':
				await dbPartialImageFound(txid)
				break;
			case 'unsupported':
				await dbUnsupportedMimeType(txid)
				break;
			case 'noop':
				// do nothing, but we need to take it out of the processing queue
				await dbNoop(txid)
				break;
		
			default:
				logger(prefix, 'UNHANDLED plugin result in http-api', txid)
				throw new Error('UNHANDLED plugin result in http-api:\n' + JSON.stringify(result))
		}
	}
}