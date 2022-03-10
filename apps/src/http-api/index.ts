require('dotenv').config()
import express from 'express'
import { dbCorruptDataConfirmed, dbCorruptDataMaybe, dbInflightDel, dbOversizedPngFound, dbPartialImageFound, dbUnsupportedMimeType, updateDb } from '../rating/db-update-txs'
import { APIFilterResult, FilterErrorResult, FilterResult } from '../shepherd-plugin-interfaces'
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
		await pluginResultHandler(req.body)
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


const pluginResultHandler = async(body: APIFilterResult)=>{
	const txid = body.txid
	const result = body.result
	
	if((typeof txid !== 'string') || txid.length !== 43){
		throw new TypeError('txid is not defined correctly')
	}

	if(result.flagged !== undefined){
		const res = await updateDb(txid, {
			flagged: result.flagged,
			valid_data: true,
		})
		if(res !== txid){
			throw new Error('Could not update database')
		}
		await dbInflightDel(txid)
		
	}else if(result.data_reason === undefined){
		throw new TypeError('data_reason and flagged cannot both be undefined')
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
		
			default:
				logger(prefix, 'UNHANDLED plugin result in http-api', txid)
				throw new Error('UNHANDLED plugin result in http-api:\n' + JSON.stringify(result))
		}
	}
}