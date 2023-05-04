import express from 'express'
import { dbCorruptDataConfirmed, dbCorruptDataMaybe, dbInflightDel, dbOversizedPngFound, dbPartialImageFound, dbUnsupportedMimeType, dbWrongMimeType, updateTxsDb } from '../common/utils/db-update-txs'
import { APIFilterResult } from '../common/shepherd-plugin-interfaces'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { slackLogger } from '../common/utils/slackLogger'
import { slackLoggerPositive } from '../common/utils/slackLoggerPositive'
import { network_EXXX_codes } from '../common/constants'

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

let count = 0
const pluginResultHandler = async(body: APIFilterResult)=>{
	const txid = body.txid
	const result = body.filterResult
	
	logger(txid, `handler begins. received ${++count}`)

	if((typeof txid !== 'string') || txid.length !== 43){
		logger(`Fatal error`,`txid is not defined correctly: ${body?.txid}`)
		throw new TypeError('txid is not defined correctly')
	}

	try{

		if(result.flagged !== undefined){
			if(result.flagged === true){
				slackLoggerPositive('matched', JSON.stringify(body))
			}
			if(result.flag_type === 'test'){
				slackLogger('✅ *Test Message* ✅', JSON.stringify(body))
			}

			const res = await updateTxsDb(txid, {
				flagged: result.flagged,
				valid_data: true,
				...(result.flag_type && { flag_type: result.flag_type}),
				...(result.top_score_name && { top_score_name: result.top_score_name}),
				...(result.top_score_value && { top_score_value: result.top_score_value}),
			})

			if(res !== txid){
				logger(`Fatal error`, `Could not update database. "${res} !== ${txid}"`)
				throw new Error('Could not update database')
			}
			
		}else if(result.data_reason === undefined){
			logger(txid, 'data_reason and flagged cannot both be undefined')
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
				case 'mimetype':
					await dbWrongMimeType(txid, result.err_message!)
					break;
				case 'retry':
					// `dbInflightDel(txid)`  is all we actually want done
					break;
			
				default:
					logger(prefix, 'UNHANDLED plugin result in http-api', txid)
					slackLogger(prefix, 'UNHANDLED plugin result in http-api', txid)
					throw new Error('UNHANDLED plugin result in http-api:\n' + JSON.stringify(result))
			}
		}
	}finally{
		await dbInflightDel(txid)
	}
}
