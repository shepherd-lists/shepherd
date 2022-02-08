import * as Gql from 'ar-gql'
import { HOST_URL, imageTypes, textTypes, videoTypes } from '../constants'
import { StateRecord, TxScanned } from '../types'
import getDbConnection from '../utils/db-connection'
import { logger } from '../utils/logger'


const db = getDbConnection()

interface IGetIdsResults {
	images: TxScanned[]
	videos: TxScanned[]
	texts: TxScanned[]
}

export const scanBlocks = async (minBlock: number, maxBlock: number): Promise<IGetIdsResults> => {
	try{

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
					# whatever else you want to query for
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
					}
				}
			}
		}`

		/* Generic getRecords */

		const getRecords = async (mediaTypes: string[]) => {
			
			const metas = await Gql.all(query, { 
				minBlock,
				maxBlock,
				mediaTypes: mediaTypes,
			})
	
			let records: TxScanned[] = []
			for (const item of metas) {
				const txid = item.node.id
				let content_type = item.node.data.type
				const content_size = item.node.data.size.toString()

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
				})

				try{
					await db<TxScanned>('txs').insert({txid, content_type, content_size}).onConflict('txid').ignore()
				}	catch(e:any){
					if(e.code && Number(e.code) === 23505){
						logger('info', 'Duplicate key value violates unique constraint', txid, e.detail)
					} else if(e.code && Number(e.code) === 23502){
						logger('Error!', 'Null value in column violates not-null constraint', txid, e.detail) 
						throw e
					} else { 
						if(e.code) logger('Error!', e.code)
						throw e
					}
				}

			}

			return records
		}

		/* get supported types metadata */

		logger('info', `making two scans of ${((maxBlock - minBlock) + 1)} blocks, from block ${minBlock} to ${maxBlock}`)
		const images = await getRecords(imageTypes)
		const videos = await getRecords(videoTypes)
		
		/* not needed yet */
		const texts: TxScanned[] = [] //await getRecords(textTypes)

		
		return {
			images,
			videos,
			texts,
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

