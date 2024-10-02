import 'dotenv/config'
import { handler } from '../lambdas/fnIndex/index'
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test'


describe('fnIndex tests', () => {

	it('should process an "index_tip" page of results', async () => {
		const event = {
			"metas": [
				{
					"cursor": "WyIyMDI0LTEwLTAyVDA1OjQzOjEwLjcyNloiLDFd",
					"node": {
						"id": "WZ3hewyjfD8xxq08wa-msJwJtrL2YCntJ3UhtIBnLB8",
						"data": { "size": "338230", "type": "image/png" },
						"tags": [{ "name": "Content-Type", "value": "image/png" }],
						"block": { "height": 1518430 },
						"parent": null,
						"owner": { "address": "cWXYyA-G7DOOgPKNY1cpdd_kvv3GTtvO4J37Nv0iNc4" }
					}
				}
			],
			"pageNumber": 0,
			"gqlUrl": "https://arweave.net/graphql",
			"gqlUrlBackup": "https://arweave-search.goldsky.com/graphql?bypass=forwardresearch-cltl6gea2000008lahvopd7kz",
			"gqlProvider": "arweave.net",
			"indexName": "indexer_tip"
		}

		//@ts-expect-error event won't match exactly
		const result = await handler(event)

		assert.equal(result, 1)

	})

})