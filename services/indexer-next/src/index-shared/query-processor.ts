import pLimit from 'p-limit'
import { slackLog } from '../../../../libs/utils/slackLog'
import { arGql } from 'ar-gql'
import { GQLError } from 'ar-gql/dist/faces'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { TxRecord } from 'shepherd-plugin-interfaces/types'


const ARIO_DELAY_MS = 500
const MAX_INGRESS_LAMBDAS = 10
const limit = pLimit(MAX_INGRESS_LAMBDAS)
const MISSING_HEIGHT = 'MISSING_HEIGHT'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const lambdaClient = new LambdaClient({})


const FN_INGRESS = process.env.FN_INGRESS as string
console.info(`FN_INDEXER: ${FN_INGRESS}`)
if (!FN_INGRESS) throw new Error('FN_INDEXER not set')

interface FnIngressReturn {
	numQueued: number;
	numUpdated: number;
	errored: TxRecord[];
}

export const gqlPages = async ({
	query,
	variables,
	indexName,
	gqlUrl,
	gqlUrlBackup,
	streamSourceName = 'nodes',
}: {
	query: string
	variables: Record<string, any>,
	indexName: string,
	gqlUrl: string,
	gqlUrlBackup: string,
	streamSourceName?: 'gateway' | 'nodes',
}) => {

	const gql = arGql({ endpointUrl: gqlUrl, retries: 3 })
	const gqlProvider = gqlUrl.includes('arweave.net') ? 'arweave.net' : 'goldsky.com'

	let hasNextPage = true
	let cursor = ''
	const promises: Promise<FnIngressReturn>[] = []
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
				console.error('err', JSON.stringify(err))
				console.error('res', JSON.stringify(res))
				console.error('edges', JSON.stringify(edges))
				const e = err as GQLError
				const status = e.cause?.status || undefined

				/** ar-gql http errors have a cause.status, otherwise connection issue */
				if (!status) {
					console.error(indexName, `gql-error '${e.message}'. trying again`, gqlProvider)
					continue
				}

				const ms = (Number(status) === 429) ? 30_000 : 10_000

				/** in all other cases sleep before retrying */
				let cause = 'unprintable?'
				try { cause = JSON.stringify(e.cause) } catch (e) { }
				await slackLog(indexName, 'gql-error', status, ':', e.message, gqlProvider, cause, `retrying in ${ms / 1000}s`)
				console.log(err)
				await sleep(ms)
				continue
			}
		}//end while-gql.run

		let logstring = ''
		let tPage = 0
		if (edges && edges.length) {
			itemCount += edges.length

			/* filter dupes from edges. batch insert does not like dupes */
			edges = [...new Map(edges.map(edge => [edge.node.id, edge])).values()]

			// Split into batches if more than 60 metas
			if (edges.length > 60 && streamSourceName !== 'gateway') {
				const midpoint = Math.ceil(edges.length / 2)
				const batch1 = edges.slice(0, midpoint)
				const batch2 = edges.slice(midpoint)

				promises.push(limit(fnIngressInvoker, { metas: batch1, pageNumber: `${pageCount}-1`, gqlUrl, gqlUrlBackup, gqlProvider, indexName, streamSourceName }))
				promises.push(limit(fnIngressInvoker, { metas: batch2, pageNumber: `${pageCount}-2`, gqlUrl, gqlUrlBackup, gqlProvider, indexName, streamSourceName }))
				pageCount++
				tPage = performance.now() - p0
				logstring = `retrieved & dispatched gql page split into ${batch1.length} and ${batch2.length} results in ${tPage.toFixed(0)} ms. cursor: ${cursor}. ${gqlProvider}`
			} else {
				promises.push(limit(fnIngressInvoker, { metas: edges, pageNumber: pageCount.toString(), gqlUrl, gqlUrlBackup, gqlProvider, indexName, streamSourceName }))
				pageCount++
				tPage = performance.now() - p0
				logstring = `retrieved & dispatched gql page of ${edges.length} results in ${tPage.toFixed(0)} ms. cursor: ${cursor}. ${gqlProvider}`
			}

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
	const numProgressed = results.reduce((acc, result) => acc + result.numQueued + result.numUpdated, 0)
	console.info(indexName, `finished ${pageCount} pages, ${numProgressed}/${itemCount} items progressed in ${(performance.now() - t0).toFixed(0)} ms`)

	return;
}

/** N.B. `inputs` must match fnIngress `event` */
const fnIngressInvoker = async (inputs: {
	metas: GQLEdgeInterface[],
	pageNumber: string,
	gqlUrl: string,
	gqlUrlBackup: string,
	gqlProvider: string,
	indexName: string,
	streamSourceName: 'gateway' | 'nodes',
}) => {
	const { indexName, pageNumber, metas, streamSourceName } = inputs
	/* invoke lambdas, retry on errors, return count */
	while (true) {
		try {
			const res = await lambdaClient.send(new InvokeCommand({
				FunctionName: FN_INGRESS as string,
				Payload: JSON.stringify(inputs),
				InvocationType: 'RequestResponse',
			}))
			if (res.FunctionError) {
				let payloadMsg = ''
				try { payloadMsg = new TextDecoder().decode(res.Payload) }
				catch (e) { payloadMsg = 'error decoding Payload with res.FunctionError' }
				throw new Error(`Lambda error '${res.FunctionError}' for ${JSON.stringify({ indexName, pageNumber })}, payload: ${payloadMsg}`)
			}

			const inserts: FnIngressReturn = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))

			console.info(indexName, fnIngressInvoker.name, `page ${pageNumber}, total records ${metas.length}, ${inserts.numQueued} queued in s3, ${inserts.numUpdated} inserts, ${inserts.errored.length} errored.`, streamSourceName)
			return inserts;
		} catch (err: unknown) {
			const e = err as Error
			slackLog(indexName, fnIngressInvoker.name, `LAMBDA ERROR ${e.name}:${e.message}. retrying after 10 seconds`, JSON.stringify(e))
			await sleep(10_000)
			continue;
		}
	}
}
