import * as Gql from 'ar-gql'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { imageTypes, videoTypes } from '../constants'
import { TxScanned } from '../types'
import getDbConnection from '../utils/db-connection'
import { logger } from '../utils/logger'
import { performance } from 'perf_hooks'


const knex = getDbConnection()
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface IGetIdsResults {
	numImages: number
	numVideos: number
	numTexts: number
}

export const scanBlocks = async (minBlock: number, maxBlock: number): Promise<IGetIdsResults> => {
	try{

		/* get supported types metadata */

		logger('info', `making two scans of ${((maxBlock - minBlock) + 1)} blocks, from block ${minBlock} to ${maxBlock}`)
		const numImages = await getRecords(minBlock, maxBlock, imageTypes)
		const numVideos = await getRecords(minBlock, maxBlock, videoTypes)
		
		/* not needed yet */
		const numTexts = 0 //await getRecords(textTypes)

		return {
			numImages,
			numVideos,
			numTexts,
		}

	} catch(e:any){

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

const getRecords = async (minBlock: number, maxBlock: number, mediaTypes: string[]) => {

	/* our general parametrized query */

	const query = `query($cursor: String, $mediaTypes: [String!]!, $minBlock: Int, $maxBlock: Int) {
		transactions(
			block: {
				min: $minBlock,
				max: $maxBlock,
			}
			tags: [
				{ name: "Content-Type", values: $mediaTypes}
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
					mediaTypes,
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