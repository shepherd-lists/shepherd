import { ArGqlInterface } from 'ar-gql'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { ARIO_DELAY_MS, IndexName } from '../common/constants'
import { TxRecord, TxScanned } from '../common/shepherd-plugin-interfaces/types'
import getDbConnection from '../common/utils/db-connection'
import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { performance } from 'perf_hooks'
import { slackLogger } from '../common/utils/slackLogger'
import memoize from 'micro-memoize'


const knex = getDbConnection()

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const scanBlocks = async (minBlock: number, maxBlock: number, gql: ArGqlInterface, indexName: IndexName) => {

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

const getRecords = async (minBlock: number, maxBlock: number, gql: ArGqlInterface, indexName: IndexName) => {

	const gqlProvider = gql.endpointUrl.includes('goldsky') ? 'gold' : 'ario'
	const query = gqlProvider === 'gold' ? queryGoldskyWild : queryArio

	let hasNextPage = true
	let cursor = ''
	let numRecords = 0 

	while(hasNextPage){
		const t0 = performance.now()
		let tGql = t0, tUpsert = t0

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
		tGql = performance.now() - t0

		let edges = res.edges
		if(edges && edges.length){
			cursor = edges[edges.length - 1].cursor

			/* filter dupes from edges. batch insert does not like dupes */
			edges = [...new Map(edges.map(edge => [edge.node.id, edge])).values()]

			numRecords += await buildRecords(edges, gql, indexName, gqlProvider)
			tUpsert = performance.now() - t0 - tGql
		}
		hasNextPage = res.pageInfo.hasNextPage

		const tProcess = performance.now() - t0
		let logstring = `processed gql page of ${edges.length} results in ${tProcess.toFixed(0)} ms. tGql:  cursor: ${cursor}. Total ${numRecords} records.`

		/* slow down, too hard to get out of arweave.net's rate-limit once it kicks in */
		if(gql.endpointUrl.includes('arweave.net')){
			let timeout = ARIO_DELAY_MS - tProcess
			if(timeout < 0) timeout = 0
			logstring += ` pausing for ${timeout}ms.`
			await sleep(timeout)
		}
		logger(indexName, logstring, `tGql: ${tGql.toFixed(0)} ms, tUpsert: ${tUpsert.toFixed(0)} ms.`, gqlProvider)
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

const buildRecords = async(metas: GQLEdgeInterface[], gql: ArGqlInterface, indexName: IndexName, gqlProvider: string)=> {
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

				try{
					p = await getParent(p, gql)
				}catch(e:any){
					throw new TypeError(`getParent error: "${e.message}" while fetching parent: ${p} for dataItem: ${txid} using gqlProvider: ${gqlProvider}`)
				}
				
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

	return insertRecords(records, indexName, gqlProvider)
}

/** export insertRecords for test only */
export const insertRecords = async(records: TxScanned[], indexName: IndexName, gqlProvider: string)=> {
	
	if(records.length === 0) return 0;

	let alteredRecords = 0
	try{
		if(indexName === 'indexer_pass1'){
			/** expecting almost zero conflicts here */
			await knex<TxRecord>('inbox_txs').insert(records).onConflict('txid').merge(['height', 'parent', 'parents', 'byteStart', 'byteEnd'])
			alteredRecords = records.length
		}else{
			/** generally speaking, it's the norm to not see updates on pass2. 
			 * we would be expecting mostly conflicts here, so we will only update 
			 * records with newer height, and insert missing records 
			 */

			const recordsInDb = await knex<TxRecord>('inbox_txs').whereIn('txid', records.map(r=>r.txid))
				
			/* step 1: update records with newer height */

			/* filter out records with same height */
			const updateRecords = records.filter(r => recordsInDb.some( exist => (r.txid === exist.txid && r.height > exist.height) ))

			// console.log({updateRecords})

			const updatedIds = await Promise.all(updateRecords.map(async r => 
				(await knex<TxRecord>('inbox_txs').update({
					height: r.height,
					parent: r.parent,
					parents: r.parents,
					byteStart: undefined,
					byteEnd: undefined,
				}).returning('txid'))[0]
			))

			alteredRecords += updatedIds.length

			console.log(`updatedIds.length ${updatedIds.length}`, 'updatedIds', updatedIds)

			/* step 2: insert missing records */

			const missingRecords = records.filter(r => !recordsInDb.map(r=>r.txid).includes(r.txid))
			alteredRecords += missingRecords.length

			console.log(`missingRecords: length ${missingRecords.length}`, missingRecords)

			if(missingRecords.length > 0){
				const res = await knex<TxRecord>('inbox_txs').insert(missingRecords).returning('txid')
				console.log(`inserted ${res.length}/${missingRecords.length} missingRecords`)
			}


		}
		
	}catch(e:any){
		if(e.code && Number(e.code) === 23502){
			logger('Error!', 'Null value in column violates not-null constraint', e.detail, gqlProvider, indexName)
			slackLogger('Error!', 'Null value in column violates not-null constraint', e.detail, gqlProvider, indexName)
			throw e
		} else { 
			if(e.code) logger('Error!', e.code, gqlProvider, indexName)
			throw e
		}
	}

	return alteredRecords;
}