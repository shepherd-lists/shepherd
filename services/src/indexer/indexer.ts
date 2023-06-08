import si from 'systeminformation'
import { performance } from 'perf_hooks'
import { scanBlocks } from "./index-blocks"
import dbConnection from "../common/utils/db-connection"
import { gqlHeight } from '../common/utils/gql-height'
import { StateRecord } from "../common/shepherd-plugin-interfaces/types"
import { logger } from "../common/shepherd-plugin-interfaces/logger"
import { slackLogger } from "../common/utils/slackLogger"
import { ArGqlInterface } from 'ar-gql'
import { PASS1_CONFIRMATIONS, PASS2_CONFIRMATIONS } from '../common/constants'


const knex = dbConnection()

/** export only for test */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** export only for test */
export const readPosition = async(indexName: string)=> (await knex<StateRecord>('states').where({ pname: indexName }))[0].value

type IndexName = 'indexer_pass1' | 'indexer_pass2'

/** export only for test */
export const topAvailableBlock =  async (height: number, CONFIRMATIONS: number, gqlEndpoint: string, indexName: IndexName) => {
	while(true){
		let h = 0
		if(indexName === 'indexer_pass1'){
			h = await gqlHeight(gqlEndpoint)
		}else{
			h = Math.min(
				await readPosition('indexer_pass1'), //pass2 can't be ahead of pass1
				await gqlHeight(gqlEndpoint)	//pass2 can't be ahead of it's own gql endpoint height
			)
		}
		if(h >= height){
			return h; //stop waiting
		}
		
		logger(
			'info', 
			(indexName === 'indexer_pass1') ? `weave height ${h}, ` : `available height ${h}, `,
			`${indexName} synced to height`, (h - CONFIRMATIONS)
		)
		await sleep(30000)
	}
}


export const indexer = async(gql: ArGqlInterface, CONFIRMATIONS: number, loop: boolean = true)=> {
	const indexName: IndexName = (CONFIRMATIONS === PASS1_CONFIRMATIONS) ? 'indexer_pass1' : 'indexer_pass2'
	const gqlEndpoint = gql.endpointUrl
	try {
		let position = await readPosition(indexName)
		/** for pass1, avoid calling getGqlHeight during initial catch up phase. pass2 won't be negative, as index starts at 90_000 */
		let topBlock = (
				indexName === 'indexer_pass1' ? await gqlHeight(gqlEndpoint) : await readPosition('indexer_pass1')
			) - CONFIRMATIONS
		const initialHeight = topBlock

		logger('initialising', `Starting ${indexName} at position ${position}. Weave height ${topBlock}`)

		/**
		 * numOfBlocks - to scan at once
		 * very rough guide:
		 * early weave this should be high: ~1000
		 * mid weave about 100?
		 * above ~350,000 <=> 657796: 50 appears ~optimal
		 * keep pace once at the top: 1
		 */
		const calcBulkBlocks = (position: number) => {
			if(position < 150000) return 1000
			if(position < 350000) return 100
			if(position < 776000) return 50
			return 1
		}
		
		let numOfBlocks = calcBulkBlocks(position)

		let minBlock = position + 1
		let maxBlock = minBlock + numOfBlocks - 1

		do{//while(true)
			try {
				const t0 = performance.now()

				if((initialHeight - maxBlock) > 50){
					numOfBlocks = calcBulkBlocks(maxBlock)
				} else if(maxBlock + CONFIRMATIONS >= topBlock){ // wait until we have enough blocks ahead
					numOfBlocks = 1
					maxBlock = minBlock
					topBlock = await topAvailableBlock(maxBlock + CONFIRMATIONS, CONFIRMATIONS, gqlEndpoint, indexName)
				}

				const numMediaFiles = await scanBlocks(minBlock, maxBlock, gql, indexName)
				logger(`${indexName} results`, 
					`media files: ${numMediaFiles},`,
					`height: ${maxBlock},`,
					`topBlock: ${topBlock}`, 
				)

				const tProcess = performance.now() - t0
				logger(indexName, `scanned ${numOfBlocks} blocks in ${tProcess} ms.`)

				/** mark 404, nodata, etc for second pass reprocessing */
				if(indexName === 'indexer_pass2'){
					const tResets = performance.now()

					const countResetInbox = await knex('inbox_txs')
						.update({ flagged: null, valid_data: null })
						.whereBetween('height', [minBlock, maxBlock])
						.whereIn('data_reason', ['404', 'nodata', 'partial'])
					const tResetsTotal = performance.now() - tResets
					logger(`${indexName} 404`, `unmarked ${countResetInbox} 404/nodata/partial records, between heights ${minBlock} & ${maxBlock}, in ${tResetsTotal.toFixed(0)} ms`)
				}

				/** TODO: call http-api to move finished records to txs */

				/** index position may have changed externally */
				const dbPosition = await readPosition(indexName)
				if(dbPosition < maxBlock){
					await knex<StateRecord>('states')
						.where({pname: indexName})
						.update({value: maxBlock})
				}else{
					maxBlock = dbPosition 
				}

				minBlock = maxBlock + 1 
				maxBlock = minBlock + numOfBlocks - 1

			} catch(e:any) {
				let status = e.cause || Number(e.response?.status) || 0
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
				await sleep(30_000)
			}
		}while(loop)//loop defaults to true, can set to false for test
	} catch(e:any) {
		logger(`UNHANDLED Fatal error in ${indexName}!`, e.name, ':', e.message)
		logger(await si.mem())
		slackLogger(`UNHANDLED Fatal error in ${indexName}!`, e.name, ':', e.message)
	}
}

