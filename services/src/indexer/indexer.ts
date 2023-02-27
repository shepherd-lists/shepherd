import si from 'systeminformation'
import { performance } from 'perf_hooks'
import { scanBlocks } from "./index-blocks"
import dbConnection from "../common/utils/db-connection"
import { getGqlHeight } from '../common/utils/gql-height'
import { StateRecord, TxRecord } from "../common/shepherd-plugin-interfaces/types"
import { logger } from "../common/shepherd-plugin-interfaces/logger"
import { slackLogger } from "../common/utils/slackLogger"
import { ArGql } from 'ar-gql'
import { INDEX_FIRST_PASS, INDEX_SECOND_PASS } from '../common/constants'


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const waitForNewBlock =  async (height: number, TRAIL_BEHIND: number, gqlEndpoint: string) => {
	while(true){
		let h = await getGqlHeight(gqlEndpoint)
		if(h >= height){
			return h; //stop waiting
		}
		logger('info', 'weave height', h, 'synced to height', (h - TRAIL_BEHIND))
		await sleep(30000)
	}
}

export const indexer = async(gql: ArGql, TRAIL_BEHIND: number)=> {
	const indexName = (TRAIL_BEHIND === INDEX_FIRST_PASS) ? 'indexer_pass1' : 'indexer_pass2'
	const gqlEndpoint = gql.getConfig().endpointUrl
	try {
		/**
		 * numOfBlocks - to scan at once
		 * very rough guide:
		 * early weave this should be high: ~1000
		 * mid weave about 100?
		 * above ~350,000 <=> 657796: 50 appears ~optimal
		 * keep pace once at the top: 1
		 */
		const knex = dbConnection()
		const readPosition = async()=> (await knex<StateRecord>('states').where({ pname: indexName }))[0].value
		let position = await readPosition()
		let topBlock = await getGqlHeight(gqlEndpoint)
		const initialHeight = topBlock // we do not want to keep calling getTopBlock during initial catch up phase

		logger('initialising', `Starting ${indexName} at position ${position}. Weave height ${topBlock}`)

		const calcBulkBlocks = (position: number) => {
			if(position < 150000) return 1000
			if(position < 350000) return 100
			if(position < 776000) return 50
			return 1
		}
		
		let numOfBlocks = calcBulkBlocks(position)

		let min = position + 1
		let max = min + numOfBlocks - 1

		while(true){
			try {
				const t0 = performance.now()

				if((initialHeight - max) > 50){
					numOfBlocks = calcBulkBlocks(max)
				} else if(max + TRAIL_BEHIND >= topBlock){ // wait until we have enough blocks ahead
					numOfBlocks = 1
					max = min
					topBlock = await waitForNewBlock(max + TRAIL_BEHIND, TRAIL_BEHIND, gqlEndpoint)
				}

				const numMediaFiles = await scanBlocks(min, max, gql, indexName)
				logger(`${indexName} results`, 
					`media files: ${numMediaFiles},`,
					`height: ${max},`,
					`topBlock: ${topBlock}`, 
				)

				const tProcess = performance.now() - t0
				logger(indexName, `scanned ${numOfBlocks} blocks in ${tProcess} ms.`)

				/** mark 404s for reprocessing on second pass */
				if(TRAIL_BEHIND === INDEX_SECOND_PASS){
					const t404 = performance.now()
					const count404s = await knex('txs')
						.update({ flagged: null, valid_data: null })
						.whereBetween('height', [min, max])
						.andWhere({ data_reason: '404' })
					const t404total = performance.now() - t404
					logger(indexName, `unmarked ${count404s} 404 records, between heights ${min} & ${max}, in ${t404total.toFixed(0)} ms`)
				}

				// index position may have changed externally
				const dbPosition = await readPosition()
				if(dbPosition < max){
					await knex<StateRecord>('states')
						.where({pname: indexName})
						.update({value: max})
				}else{
					max = dbPosition
				}

				min = max + 1 
				max = min + numOfBlocks - 1

			} catch(e:any) {
				let status = Number(e.response?.status) || 0
				if( status >= 500 ){
					logger(indexName, `GATEWAY ERROR! ${e.name}(${status}) : ${e.message}`)
				}
				
				if( status === 429 ){
					logger(indexName, `${e.name}(${status}) : ${e.message}. Waiting 5 minutes to try and timeout rate-limit.`)
					logger(await si.mem())
					await sleep(300_000)
					continue;
				}

				logger('Error!', `${indexName} fell over. Waiting 30 seconds to try again.`, `${e.name}(${status}) : ${e.message}`)
				slackLogger(`${indexName} fell over. Waiting 30 seconds to try again.`, `${e.name}(${status}) : ${e.message}`)
				logger(await si.mem())
				await sleep(30000)
			}
		}///end while(true)
	} catch(e:any) {
		logger(`UNHANDLED Fatal error in ${indexName}!`, e.name, ':', e.message)
		logger(await si.mem())
		slackLogger(`UNHANDLED Fatal error in ${indexName}!`, e.name, ':', e.message)
	}
}

