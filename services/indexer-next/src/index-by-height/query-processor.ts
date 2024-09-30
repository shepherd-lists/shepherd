import pLimit from 'p-limit'
import { slackLog } from '../../../../libs/utils/slackLog'
import { ArGqlInterface } from 'ar-gql'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'


const ARIO_DELAY_MS = 500
const MAX_INDEXER_LAMBDAS = 10
const limit = pLimit(MAX_INDEXER_LAMBDAS)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export const gqlPages = async ({
	query,
	variables,
	indexName,
	gql,
	gqlBackup,
}: {
	query: string
	variables: Record<string, any>,
	indexName: string,
	gql: ArGqlInterface,
	gqlBackup: ArGqlInterface,
}) => {

	const gqlProvider = gql.endpointUrl.includes('goldsky') ? 'goldsky.com' : 'arweave.net'

	let hasNextPage = true
	let cursor = ''
	const promises: Promise<number>[] = []
	const t0 = performance.now()
	let pageCount = 0, itemCount = 0

	while (hasNextPage) {
		const p0 = performance.now()

		let res
		while (true) {
			try {
				res = (await gql.run(query, {
					...variables,
					cursor,
				})).data.transactions
				break
			} catch (err: unknown) {
				const e = err as Error
				const status = Number(e.cause) || 0
				if (!e.cause) {
					console.error(indexName, `gql-error '${e.message}'. trying again`, gqlProvider)
					continue
				}

				/** getting a lot of temporary 502 errors lately */
				if (status === 502) {
					console.error(indexName, 'gql-error', status, ':', e.message, gqlProvider)
					await slackLog(indexName, 'gql-error', status, ':', e.message, gqlProvider, 'retrying in 10s')
					console.log(err)
					await sleep(10_000)
					continue
				}

				console.error(indexName, 'gql-error', status, ':', e.message, gqlProvider)

				throw e
			}
		}//end while-gql.run

		let edges = res.edges
		if (edges && edges.length) {
			cursor = edges[edges.length - 1].cursor
			itemCount += edges.length

			/* filter dupes from edges. batch insert does not like dupes */
			edges = [...new Map(edges.map(edge => [edge.node.id, edge])).values()]

			promises.push(limit(lambdaInvoker, edges, pageCount, gql, indexName, gqlProvider, gqlBackup))

		}
		hasNextPage = res.pageInfo.hasNextPage

		const tPage = performance.now() - p0
		let logstring = `retrieved & dispatched gql page of ${edges.length} results in ${tPage.toFixed(0)} ms. cursor: ${cursor}. ${gqlProvider}`

		/* slow down, too hard to get out of arweave.net's rate-limit once it kicks in */
		if (gql.endpointUrl.includes('arweave.net')) {
			let timeout = ARIO_DELAY_MS - tPage
			if (timeout < 0) timeout = 0
			logstring += ` pausing for ${timeout}ms.`
			console.info(indexName, logstring)
			await sleep(timeout)
		} else {
			console.info(indexName, logstring)
		}
	}//end while(hasNextPage)

	const results = await Promise.all(promises)
	const inserted = results.reduce((acc, result) => acc + result, 0)
	console.info(indexName, `${pageCount} pages, ${inserted}/${itemCount} items inserted in ${performance.now() - t0}`)

	return;
}

const lambdaInvoker = async (metas: GQLEdgeInterface[], pageNumber: number, gql: ArGqlInterface, indexName: string, gqlProvider: string, gqlBackup: ArGqlInterface) => {
	//TODO: invoke lambdas, retry on errors, return count
	return 0
}