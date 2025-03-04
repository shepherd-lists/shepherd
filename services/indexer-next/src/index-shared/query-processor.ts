import pLimit from 'p-limit'
import { slackLog } from '../../../../libs/utils/slackLog'
import { arGql } from 'ar-gql'
import { GQLError } from 'ar-gql/dist/faces'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'


const ARIO_DELAY_MS = 500
const MAX_INDEXER_LAMBDAS = 10
const limit = pLimit(MAX_INDEXER_LAMBDAS)
const MISSING_HEIGHT = 'MISSING_HEIGHT'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const lambdaClient = new LambdaClient({})


const FN_INDEXER = process.env.FN_INDEXER as string //ario by default
console.info(`FN_INDEXER: ${FN_INDEXER}`)
if (!FN_INDEXER) throw new Error('FN_INDEXER not set')


export const gqlPages = async ({
	query,
	variables,
	indexName,
	gqlUrl,
	gqlUrlBackup,
}: {
	query: string
	variables: Record<string, any>,
	indexName: string,
	gqlUrl: string,
	gqlUrlBackup: string,
}) => {

	const gql = arGql({ endpointUrl: gqlUrl, retries: 3 })
	const gqlProvider = gqlUrl.includes('goldsky') ? 'goldsky.com' : 'arweave.net'

	let hasNextPage = true
	let cursor = ''
	const promises: Promise<number>[] = []
	const t0 = performance.now()
	let pageCount = 0, itemCount = 0

	while (hasNextPage) {
		const p0 = performance.now()

		let edges, res
		while (true) {
			try {
				res = await gql.run(query, {
					...variables,
					cursor,
				})
				edges = res.data.transactions.edges

				/** workaround: some ingested_at items are being returned without heights, i.e. still pending. skip and get later with heights */
				cursor = edges.length ? edges[edges.length - 1].cursor : ''
				edges = edges.filter(({ node }) => {
					if (!node.block?.height) {
						console.warn(indexName, MISSING_HEIGHT, 'from', node.id)
						return false
					}
					return true
				})

				break
			} catch (err: unknown) {
				console.error(JSON.stringify({ err }))
				console.error(JSON.stringify({ res }))
				console.error(JSON.stringify({ edges }))
				const e = err as GQLError
				const status = e.cause?.status || undefined

				/** ar-gql http errors have a cause.status, otherwise connection issue */
				if (!status) {
					console.error(indexName, `gql-error '${e.message}'. trying again`, gqlProvider)
					continue
				}

				/** in all other cases sleep before retrying */
				await slackLog(indexName, 'gql-error', status, ':', e.message, gqlProvider, String(e.cause), 'retrying in 10s')
				console.log(err)
				await sleep(10_000)
				continue
			}
		}//end while-gql.run

		let logstring = ''
		let tPage = 0
		if (edges && edges.length) {
			itemCount += edges.length

			/* filter dupes from edges. batch insert does not like dupes */
			edges = [...new Map(edges.map(edge => [edge.node.id, edge])).values()]

			promises.push(limit(fnIndexerInvoker, { metas: edges, pageNumber: pageCount++, gqlUrl, gqlUrlBackup, gqlProvider, indexName }))

			tPage = performance.now() - p0
			logstring = `retrieved & dispatched gql page of ${edges.length} results in ${tPage.toFixed(0)} ms. cursor: ${cursor}. ${gqlProvider}`
		} else {
			logstring = `no pages to dispatch. cursor: ${cursor}`
		}


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

		hasNextPage = res.data.transactions.pageInfo.hasNextPage
	}//end while(hasNextPage)

	const results = await Promise.all(promises)
	const inserted = results.reduce((acc, result) => acc + result, 0)
	console.info(indexName, `finished ${pageCount} pages, ${inserted}/${itemCount} items inserted in ${(performance.now() - t0).toFixed(0)} ms`)

	return;
}

/** N.B. `inputs` must match fnIndex `event` */
const fnIndexerInvoker = async (inputs: {
	metas: GQLEdgeInterface[],
	pageNumber: number,
	gqlUrl: string,
	gqlUrlBackup: string
	gqlProvider: string,
	indexName: string,
}) => {
	const { indexName, pageNumber, metas } = inputs
	/* invoke lambdas, retry on errors, return count */
	while (true) {
		try {
			const res = await lambdaClient.send(new InvokeCommand({
				FunctionName: FN_INDEXER as string,
				Payload: JSON.stringify(inputs),
				InvocationType: 'RequestResponse',
			}))
			if (res.FunctionError) {
				let payloadMsg = ''
				try { payloadMsg = new TextDecoder().decode(res.Payload) }
				catch (e) { payloadMsg = 'error decoding Payload with res.FunctionError' }
				throw new Error(`Lambda error '${res.FunctionError}' for ${JSON.stringify({ indexName, pageNumber })}, payload: ${payloadMsg}`)
			}

			const inserts: number = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))

			console.info(indexName, fnIndexerInvoker.name, `page ${pageNumber}, ${inserts}/${metas.length} inserted`)
			return inserts;
		} catch (err: unknown) {
			const e = err as Error
			slackLog(indexName, fnIndexerInvoker.name, `LAMBDA ERROR ${e.name}:${e.message}. retrying after 10 seconds`, JSON.stringify(e))
			await sleep(10_000)
			continue;
		}
	}
}
