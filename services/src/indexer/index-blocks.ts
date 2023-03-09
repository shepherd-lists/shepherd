import { ArGqlInterface } from 'ar-gql'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { ARIO_DELAY_MS } from '../common/constants'
import { TxScanned } from '../common/shepherd-plugin-interfaces/types'
import getDbConnection from '../common/utils/db-connection'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { performance } from 'perf_hooks'
import { slackLogger } from '../common/utils/slackLogger'
import memoize from 'micro-memoize'


const knex = getDbConnection()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const scanBlocks = async (minBlock: number, maxBlock: number, gql: ArGqlInterface, indexName: string) => {

	/* get images and videos */

	logger(indexName, `making 1 scans of ${((maxBlock - minBlock) + 1)} blocks, from block ${minBlock} to ${maxBlock}`)
	return await getRecords(minBlock, maxBlock, gql, indexName)
}

/* our specialised queries */
 
const queryGoldskyWild = `query($cursor: String, $minBlock: Int, $maxBlock: Int) {
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

const queryArio = `query($cursor: String, $minBlock: Int, $maxBlock: Int) {
	transactions(
		block: {
			min: $minBlock,
			max: $maxBlock,
		}
		tags: [
			{ name: "Content-Type", values: [
				"image/bmp",
				"image/jpeg",
				"image/jpg",
				"image/png",
				"image/gif",
				"image/tiff",
				"image/webp",
				"image/x-ms-bmp",
				"image/svg+xml",
				"image/apng",
				"image/heic",
				"video/3gpp",
				"video/3gpp2",
				"video/mp2t",
				"video/mp4",
				"video/mpeg",
				"video/ogg",
				"video/quicktime",
				"video/webm",
				"video/x-flv",
				"video/x-m4v",
				"video/x-msvideo",
				"video/x-ms-wmv",
			] }
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



/* Generic getRecords */

const getRecords = async (minBlock: number, maxBlock: number, gql: ArGqlInterface, indexName: string) => {

	const gqlProvider = gql.endpointUrl.includes('goldsky') ? 'gold' : 'ario'
	const query = gqlProvider === 'gold' ? queryGoldskyWild : queryArio

	let hasNextPage = true
	let cursor = ''
	let numRecords = 0 

	while(hasNextPage){
		const t0 = performance.now()
		let res; 
		while(true){
			try{
				res = (await gql.run(query, { 
					minBlock,
					maxBlock,
					cursor,
				})).data.transactions
				break;
			}catch(e:any){
				if(!e.cause){
					logger(indexName, `gql-error '${e.message}'. trying again`, gqlProvider)
					continue;
				}

				logger(indexName, 'gql-error', e.status, ':', e.message, gqlProvider)
				throw e;
			}
		}
		let edges = res.edges
		if(edges && edges.length){
			cursor = edges[edges.length - 1].cursor

			/* filter dupes from edges. batch insert does not like dupes */
			edges = [...new Map(edges.map(edge => [edge.node.id, edge])).values()]

			numRecords += await insertRecords(edges, gql, indexName, gqlProvider)
		}
		hasNextPage = res.pageInfo.hasNextPage

		const tProcess = performance.now() - t0
		let logstring = `processed gql page of ${edges.length} results in ${tProcess.toFixed(0)} ms. cursor: ${cursor}. Total ${numRecords} records.`

		/* slow down, too hard to get out of arweave.net's rate-limit once it kicks in */
		if(gql.endpointUrl.includes('arweave.net')){
			let timeout = ARIO_DELAY_MS - tProcess
			if(timeout < 0) timeout = 0
			logstring += ` pausing for ${timeout}ms.`
			await sleep(timeout)
		}
		logger(indexName, logstring, gqlProvider)
	}

	return numRecords
}

const getParent = memoize(
	async(p: string, gql: ArGqlInterface)=> {
		const res = await gql.tx(p)
		return res.parent?.id || null
	},
	{ 
		isPromise: true,
		maxSize: 10000, //allows for caching of maxSize number of bundles per query (1 block).
		// onCacheHit: ()=>console.log(`getParent cache hit`),
		// onCacheAdd: async(cache, options)=> console.log(cache.keys, cache.values),
	},
)

const insertRecords = async(metas: GQLEdgeInterface[], gql: ArGqlInterface, indexName: string, gqlProvider: string)=> {
	let records: TxScanned[] = []

	for (const item of metas) {
		const txid = item.node.id
		let content_type = item.node.data.type
		const content_size = item.node.data.size.toString()
		const height = item.node.block.height // missing height should not happen and cause `TypeError : Cannot read properties of null (reading 'height')`
		const parent = item.node.parent?.id || null // the direct parent, if exists
		const parents: string[] = []

		// this content_type is missing for dataItems
		if(!content_type){ 
			for(const tag of item.node.tags){
				if(tag.name === 'Content-Type'){
					content_type = tag.value
					break;
				}
			}
		}

		// loop to find all nested parents
		if(parent){
			let p: string | null = parent
			do{
				const t0 = performance.now()
				const p0 = p

				p = await getParent(p, gql)
				
				const t1 = performance.now() - t0

				/* if time less than 10ms, it's definitely a cache hit */
				if(t1 > 10){
					let logstring = `got parent ${p0} details in ${t1.toFixed(0)}ms.`

					/* slow down, too hard to get out of arweave.net's rate-limit once it kicks in */
					if(gql.endpointUrl.includes('arweave.net')){
						let timeout = ARIO_DELAY_MS - t1
						if(timeout < 0) timeout = 0
						logstring += ` pausing for ${timeout.toFixed(0)}ms.`
						await sleep(timeout)
					}
					logger(indexName, txid, logstring, gqlProvider)
				}

			}while(p && parents.push(p))
		}

		records.push({
			txid, 
			content_type,
			content_size,
			height,
			parent,
			...(parents.length > 0 && {parents}), //leave `parents` null if not nested
		})
	}

	try{
		await knex<TxScanned>('txs').insert(records).onConflict('txid').merge(['height', 'parent', 'parents'])
	}	catch(e:any){
		if(e.code && Number(e.code) === 23502){
			logger('Error!', 'Null value in column violates not-null constraint', e.detail, gqlProvider, indexName)
			slackLogger('Error!', 'Null value in column violates not-null constraint', e.detail, gqlProvider, indexName)
			throw e
		} else { 
			if(e.code) logger('Error!', e.code, gqlProvider, indexName)
			throw e
		}
	}

	return records.length
}