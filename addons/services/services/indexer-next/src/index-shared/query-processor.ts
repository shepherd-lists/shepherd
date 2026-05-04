import pLimit from 'p-limit'
import { slackLog } from '../../../../libs/utils/slackLog'
import { arGql } from 'ar-gql'
import { GQLError } from 'ar-gql/dist/faces'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { handler as fnIngressHandler } from '../../../../lambdas/fnIngress/index'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { batchUpsertTxsWithRules } from '../../../../libs/utils/pgClient'


const ARIO_DELAY_MS = 500
const MAX_INGRESS_LAMBDAS = 10
const limit = pLimit(MAX_INGRESS_LAMBDAS)
const MISSING_HEIGHT = 'MISSING_HEIGHT'
const CHUNKS_BATCH_SIZE = 50
const SHORT_DOWNLOAD_TIMEOUT = 90_000 //ms
const LONG_DOWNLOAD_TIMEOUT = 14 * 60_000 //14 mins
const LARGE_DATA_SIZE = 500 * 1024 * 1024 //500MB


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface FnIngressReturn {
	numQueued: number;
	numUpdated: number;
	errored: { queued: boolean; record: TxRecord; errorId?: string }[];
}

/* function to split ingress results into timeout-pending vs hard-errored records */
const splitPendingErrored = (results: FnIngressReturn[]) => results.reduce((acc, result) => {
	result.errored.forEach(value => value.errorId === 'timeout' ? acc.pending.push(value.record) : acc.errored.push({ ...value.record, errorId: value.errorId } as TxRecord))
	return acc
}, { pending: [], errored: [] } as { pending: TxRecord[], errored: TxRecord[] })


export const gqlPages = async ({
	query,
	variables,
	indexName,
	gqlUrl,
	gqlUrlBackup,
	streamSourceName = 'gateway',// 'nodes',
}: {
	query: string
	variables: Record<string, any>,
	indexName: string,
	gqlUrl: string,
	gqlUrlBackup: string,
	streamSourceName?: 'gateway' | 'nodes',
}) => {

	const gql = arGql({ endpointUrl: gqlUrl, retries: 3 })
	const gqlProvider = gqlUrl.includes('goldsky') ? 'goldsky.com' : 'arweave.net'


	let hasNextPage = true
	let cursor = ''
	const lambdaPromises: Promise<FnIngressReturn>[] = []
	const t0 = performance.now()
	let pageCount = 0, itemCount = 0

	const allEdges = new Map<string, GQLEdgeInterface>()

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

			/* store for our retries */
			edges.forEach(edge => allEdges.set(edge.node.id, edge))

			/* separate out large files */
			const { small, large } = edges.reduce((acc, edge) => {
				+edge.node.data.size < LARGE_DATA_SIZE ? acc.small.push(edge) : acc.large.push(edge)
				return acc;
			}, { small: [], large: [] } as { small: GQLEdgeInterface[], large: GQLEdgeInterface[] })

			if (large.length > 0) {
				console.info(indexName, `large files: ${large.length}`)
			}

			/* split page into batches to process in lambda */
			let batchCountTot = 0, batchSizesTot = []
			if (small.length > 0) {
				const { batchCount, batchSizes } = batchAndDispatchEdges(
					small,
					pageCount.toString(),
					streamSourceName,
					gqlUrl,
					gqlUrlBackup,
					gqlProvider,
					indexName,
					lambdaPromises,
					SHORT_DOWNLOAD_TIMEOUT, //this is what we are separating really
				)
				batchCountTot += batchCount
				batchSizesTot.push(...batchSizes)
			}
			if (large.length > 0) {
				const { batchCount, batchSizes } = batchAndDispatchEdges(
					large,
					pageCount.toString(),
					streamSourceName,
					gqlUrl,
					gqlUrlBackup,
					gqlProvider,
					indexName,
					lambdaPromises,
					LONG_DOWNLOAD_TIMEOUT,
				)
				batchCountTot += batchCount
				batchSizesTot.push(...batchSizes)
			}

			pageCount++
			tPage = performance.now() - p0

			logstring = `retrieved & dispatched gql page into ${batchCountTot} batches [${batchSizesTot.join(', ')}] in ${tPage.toFixed(0)} ms. cursor: ${cursor}. ${gqlProvider}`
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

	/** wait for all lambda invocations to complete */
	const results = await Promise.all(lambdaPromises)

	const { pending, errored } = splitPendingErrored(results)

	//debug slacks
	if (errored.length > 0) slackLog(`DEBUG chunks errored ${errored.length}.`, JSON.stringify(errored))
	if (pending.length > 0) slackLog(`DEBUG chunks pending ${pending.length}.`, JSON.stringify(pending))//.map(({ txid, content_size, content_type }) => ({ txid, content_size, content_type }))))

	console.info(`pending: ${pending.length}, errored: ${errored.length}`)

	/** retry the pending/errored records with a longer download timeout on HOST_URL gateway */

	if (pending.length > 0 || errored.length > 0) {
		const promisesRetries: Promise<FnIngressReturn>[] = []
		const toRetry = [...pending, ...errored].map(record => allEdges.get(record.txid)).filter(Boolean) as GQLEdgeInterface[]

		const { batchCount, batchSizes } = batchAndDispatchEdges(
			toRetry,
			'retries',
			'gateway', //
			gqlUrl,
			gqlUrlBackup,
			gqlProvider,
			indexName,
			promisesRetries,
			LONG_DOWNLOAD_TIMEOUT,
		)

		const resultsRetries = await Promise.all(promisesRetries)
		const retried = splitPendingErrored(resultsRetries)

		console.info(`retried ${batchCount} batches [${batchSizes.join(', ')}] for pending/errored records using 'gateway' stream source`)

		/** if items are still failing, make some noise, they need to be manually attempted currently! */

		if (retried.pending.length > 0) slackLog(`DEBUG retried pending 💀❌ ${retried.pending.length}.`, JSON.stringify(retried.pending))
		if (retried.errored.length > 0) slackLog(`DEBUG retried errored 💀❌ ${retried.errored.length}.`, JSON.stringify(retried.errored))

		console.info(`retried pending: ${retried.pending.length}, retried errored: ${retried.errored.length}`)

		/** write out	*failed* retried records to db with flagged=null <- need to re-check! */
		const recordsToUpsert = [...retried.pending, ...retried.errored].map((r: TxRecord & { errorId?: string }): TxRecord => ({
			txid: r.txid,
			content_type: r.content_type,
			content_size: r.content_size,
			height: r.height,
			parent: r.parent,
			parents: r.parents,
			owner: r.owner,
			last_update_date: new Date(),
			data_reason: r.errorId as TxRecord['data_reason'] || 'timeout',
			//@ts-expect-error flagged: null is valid for retry records.
			flagged: null, valid_data: null,
		}))
		const upserted = await batchUpsertTxsWithRules(recordsToUpsert, 'txs')
		console.info(`upserted ${upserted?.length || 0} records`)
	}

	/** final log for current query processor run */

	const numProgressed = results.reduce((acc, result) => acc + result.numQueued + result.numUpdated, 0)
	console.info(indexName, `finished ${pageCount} pages, ${numProgressed}/${itemCount} items progressed in ${(performance.now() - t0).toFixed(0)} ms`)
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
	downloadTimeout: number,
}) => {
	const { indexName, pageNumber, metas, streamSourceName } = inputs
	console.log(`${indexName} fnIngressInvoker starting for page ${pageNumber}`)
	while (true) {
		try {
			const processed: FnIngressReturn = await fnIngressHandler(inputs)

			console.info(indexName, fnIngressInvoker.name, `page ${pageNumber}, total records ${metas.length}, ${processed.numQueued} queued in s3, ${processed.numUpdated} inserts, ${processed.errored.length} errored.`, streamSourceName)

			return processed;
		} catch (err: unknown) {
			const e = err as Error
			await slackLog(indexName, fnIngressInvoker.name, `HANDLER ERROR ${e.name}:${e.message}. retrying after 10 seconds...`, JSON.stringify(e))
			await sleep(10_000)
			continue;
		}
	}
}

const batchAndDispatchEdges = (
	edges: GQLEdgeInterface[],
	pageNumber: string,
	streamSourceName: 'gateway' | 'nodes',
	gqlUrl: string,
	gqlUrlBackup: string,
	gqlProvider: string,
	indexName: string,
	promises: Promise<FnIngressReturn>[],
	downloadTimeout: number,
) => {
	const batchSize = (streamSourceName === 'nodes') ? CHUNKS_BATCH_SIZE : 100
	const batchSizes = []
	let batchCount = 0
	for (let i = 0; i < edges.length; i += batchSize) {
		const batch = edges.slice(i, i + batchSize)
		batchSizes.push(batch.length)
		promises.push(limit(fnIngressInvoker, {
			metas: batch,
			pageNumber: `${pageNumber}-${batchCount}`,
			gqlUrl,
			gqlUrlBackup,
			gqlProvider,
			indexName,
			streamSourceName,
			downloadTimeout,
		}))
		batchCount++
	}
	return { batchCount, batchSizes }
}
