import * as Gql from 'arca-gql'
import { GQLEdgeInterface } from 'arca-gql/dist/faces'
import { GQL_URL, imageTypes, videoTypes } from '../common/constants'
import { TxScanned } from '../common/shepherd-plugin-interfaces/types'
import getDbConnection from '../common/utils/db-connection'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { performance } from 'perf_hooks'
import { slackLogger } from '../common/utils/slackLogger'


const knex = getDbConnection()

Gql.setEndpointUrl(GQL_URL)


export const scanBlocks = async (minBlock: number, maxBlock: number) => {
	try{

		/* get images and videos */

		logger('info', `making 1 scans of ${((maxBlock - minBlock) + 1)} blocks, from block ${minBlock} to ${maxBlock}`)
		return await getRecords(minBlock, maxBlock)

	}catch(e:any){

		let status = Number(e.response?.status) || 0

		if( status >= 500 ){
			logger('GATEWAY ERROR!', e.message, 'Waiting for 30 seconds...')
			throw e
		}else{
			logger('Error!', e.code, ':', e.message)
			logger(e)
			logger("Error in scanBlocks. See above.")
			throw e 
		}
	}
}


/* Generic getRecords */

const getRecords = async (minBlock: number, maxBlock: number) => {

	/* our general parametrized query */

	const query = `query($cursor: String, $minBlock: Int, $maxBlock: Int) {
		transactions(
			block: {
				min: $minBlock,
				max: $maxBlock,
			}
			tags: [
				{ name: "Content-Type", values: ["video/*", "image/*"], match: WILDCARD}
			]
			first: 100
			after: $cursor
		) {
			pageInfo {
				hasNextPage
			}
			edges {
				cursor
				node{
					id
					data{
						size
						type
					}
					tags{ 
						name 
						value
					}
					block{
						height
					}
					parent{
						id
					}
				}
			}
		}
	}`


	let hasNextPage = true
	let cursor = ''
	let numRecords = 0 

	while(hasNextPage){
		const t0 = performance.now()
		let res; 
		while(true){
			try{
				res = (await Gql.run(query, { 
					minBlock,
					maxBlock,
					cursor,
				})).data.transactions
				break;
			}catch(e:any){
				if(e instanceof TypeError){
					logger('gql-error', 'data: null. errors in res.data.errors')
					continue;
				}
				if(e.code && e.code === 'ECONNRESET'){
					logger('gql-error', 'ECONNRESET')
					continue;
				}
				// if(e.response?.status === 504){
				// 	logger('gql-error', e.response?.status, ':', e.message)
				// 	continue;
				// }
				logger('gql-error', e.response?.status, ':', e.message)
				throw e;
			}
		}

		if(res.edges && res.edges.length){
			//do something with res.edges
			numRecords += await insertRecords(res.edges)
			cursor = res.edges[res.edges.length - 1].cursor
		}
		hasNextPage = res.pageInfo.hasNextPage

		const tProcess = performance.now() - t0
		logger('info', `processed gql page of ${res.edges.length} results in ${tProcess.toFixed(0)} ms. cursor: ${cursor}. Total ${numRecords} records.`)
	}

	return numRecords
}

const insertRecords = async(metas: GQLEdgeInterface[])=> {
	let records: TxScanned[] = []

	for (const item of metas) {
		const txid = item.node.id
		let content_type = item.node.data.type
		const content_size = item.node.data.size.toString()
		const height = item.node.block.height
		const parent = item.node.parent?.id || null

		//sanity
		if(!height) slackLogger(`HeightError : no height for '${txid}'`)

		// this content_type is missing for dataItems
		if(!content_type){ 
			for(const tag of item.node.tags){
				if(tag.name === 'Content-Type'){
					content_type = tag.value
					break;
				}
			}
		}

		records.push({
			txid, 
			content_type,
			content_size,
			height,
			parent,
		})
	}

	try{
		await knex<TxScanned>('txs').insert(records).onConflict('txid').ignore()
	}	catch(e:any){
		if(e.code && Number(e.code) === 23505){
			logger('info', 'Duplicate key value violates unique constraint', e.detail)
		} else if(e.code && Number(e.code) === 23502){
			logger('Error!', 'Null value in column violates not-null constraint', e.detail)
			throw e
		} else { 
			if(e.code) logger('Error!', e.code)
			throw e
		}
	}

	return records.length
}