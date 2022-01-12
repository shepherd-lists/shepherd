require('dotenv').config() //first line of entrypoint
import axios from "axios"
import { HOST_URL } from "../constants"
import { StateRecord } from "../types"
import dbConnection from "../utils/db-connection"
import { logger } from "../utils/logger"
import { scanBlocks } from "./scan-blocks"
import { performance } from 'perf_hooks'
import { slackLogger } from "../utils/slackLogger"


//leave some space from weave head (trail behind) to avoid orphan forks and allow tx data to be uploaded
const TRAIL_BEHIND = 15 

const getTopBlock = async () => {
	//return Number((await axios.get(`${HOST_URL}/info`)).data.height)
	/* use GQL's current block as it can get out of sync */

	const query = "query($minBlock: Int) {\n  blocks(\n    height: {\n      min: $minBlock,\n    }\n    first: 1\n    sort: HEIGHT_DESC\n    \n  ){\n    edges {\n      node {\n        height\n      }\n    }\n  }\n}"
	const { data } =  await axios.post('https://arweave.net/graphql', {
		query,
	})
	return +data.data.blocks.edges[0].node.height
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const waitForNewBlock =  async (height: number) => {
	while(true){
		let h = await getTopBlock()
		if(h >= height){
			return h; //stop waiting
		}
		logger('info', 'weave height', h, 'synced to height', (h - TRAIL_BEHIND))
		await sleep(30000)
	}
}

const scanner = async()=> {
	try {
		/**
		 * numOfBlocks - to scan at once
		 * very rough guide:
		 * early weave this should be high: ~1000
		 * mid weave about 100?
		 * above ~350,000 <=> 657796: 50 appears ~optimal
		 * keep pace once at the top: 1
		 */
		const db = dbConnection()
		let position = (await db<StateRecord>('states').where({pname: 'scanner_position'}))[0].value
		let topBlock = await getTopBlock()
		const initialHeight = topBlock // we do not want to keep calling getTopBlock during initial catch up phase

		logger('initialising', 'Starting scanner position', position, 'and weave height', topBlock)

		const calcBulkBlocks = (position: number) => {
			if(position < 150000) return 1000
			if(position < 350000) return 100
			if(position < 776000) return 50
			return 2
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
					topBlock = await waitForNewBlock(max + TRAIL_BEHIND)
				}

				const res = await scanBlocks(min, max)
				logger('results', 
					'images:', res.images.length, ',',
					'videos:', res.videos.length, ',',
					'texts:', res.texts.length, ',',
					'scanner_position:', max, ',',
					'topBlock:', topBlock, 
				)

				min = max + 1 
				max = min + numOfBlocks - 1

				const tProcess = performance.now() - t0
				let timeout = 2000 - tProcess
				if(timeout < 0) timeout = 0
				console.log(`scanned ${numOfBlocks} blocks in ${tProcess} ms. pausing for ${timeout}ms`)
				await sleep(timeout) //slow down, we're getting rate-limited 

			} catch(e:any) {
				logger('Error!', 'Scanner fell over. Waiting 30 seconds to try again.')
				await sleep(30000)
			}
		}///end while(true)
	} catch(e:any) {
		logger('UNHANDLED Error in scanner!', e.name, ':', e.message)
		slackLogger('UNHANDLED Error in scanner!', e.name, ':', e.message)
	}
}
scanner()
