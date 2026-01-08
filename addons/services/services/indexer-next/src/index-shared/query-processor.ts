import pLimit from 'p-limit'
import { slackLog } from '../../../../libs/utils/slackLog'
import { arGql } from 'ar-gql'
import { GQLError } from 'ar-gql/dist/faces'
import { GQLEdgeInterface } from 'ar-gql/dist/faces'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { batchUpsertTxsWithRules } from '../../../../libs/utils/pgClient'


const ARIO_DELAY_MS = 500
const MAX_INGRESS_LAMBDAS = 10
const limit = pLimit(MAX_INGRESS_LAMBDAS)
const MISSING_HEIGHT = 'MISSING_HEIGHT'
const CHUNKS_BATCH_SIZE = 50
const PASS1_DOWNLOAD_TIMEOUT = 60_000 //ms
const LONG_DOWNLOAD_TIMEOUT = 14 * 60_000 //14 mins


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const lambdaClient = new LambdaClient({})


const FN_INGRESS = process.env.FN_INGRESS as string
console.info(`FN_INDEXER: ${FN_INGRESS}`)
if (!FN_INGRESS) throw new Error('FN_INDEXER not set')

interface FnIngressReturn {
	numQueued: number;
	numUpdated: number;
	errored: { queued: boolean; record: TxRecord; errorId?: string }[];
}

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
	const gqlProvider = gqlUrl.includes('arweave.net') ? 'arweave.net' : 'goldsky.com'


	let hasNextPage = true
	let cursor = ''
	const promises: Promise<FnIngressReturn>[] = []
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

			//store for our retries
			edges.forEach(edge => allEdges.set(edge.node.id, edge))

			/* split page into batches to process in lambda */
			const { batchCount, batchSizes } = batchAndDispatchEdges(
				edges,
				pageCount.toString(),
				streamSourceName,
				gqlUrl,
				gqlUrlBackup,
				gqlProvider,
				indexName,
				promises,
				/* downloadTimeout: */ PASS1_DOWNLOAD_TIMEOUT, //ms (adjust this later)
			)

			pageCount++
			tPage = performance.now() - p0

			logstring = `retrieved & dispatched gql page into ${batchCount} batches [${batchSizes.join(', ')}] in ${tPage.toFixed(0)} ms. cursor: ${cursor}. ${gqlProvider}`
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

	const [pending, errored] = results.reduce((acc, result) => {
		result.errored.forEach(value => value.errorId === 'timeout' ? acc[0].push(value.record) : acc[1].push({ ...value.record, errorId: value.errorId } as TxRecord))
		return acc
	}, [[], []] as [TxRecord[], TxRecord[]])

	//temporary debug slacks
	if (errored.length > 0) slackLog(`DEBUG errored ${errored.length}.`, JSON.stringify(errored))
	if (pending.length > 0) slackLog(`DEBUG pending ${pending.length}.`, JSON.stringify(pending.map(({ txid, content_size, content_type }) => ({ txid, content_size, content_type }))))

	console.info(`pending: ${pending.length}, errored: ${errored.length}`)

	//now retry the pending/errored records with a longer download timeout
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
		const [pendingRetries, erroredRetries] = resultsRetries.reduce((acc, result) => {
			result.errored.forEach(value => value.errorId === 'timeout' ? acc[0].push(value.record) : acc[1].push({ ...value.record, errorId: value.errorId } as TxRecord))
			return acc
		}, [[], []] as [TxRecord[], TxRecord[]])

		console.info(`retried ${batchCount} batches [${batchSizes.join(', ')}] for pending/errored records using 'gateway' stream source`)

		if (pendingRetries.length > 0) slackLog(`DEBUG pending retries 💀❌ ${pendingRetries.length}.`, JSON.stringify(pendingRetries))
		if (erroredRetries.length > 0) slackLog(`DEBUG errored retries 💀❌ ${erroredRetries.length}.`, JSON.stringify(erroredRetries))

		console.info(`pending retries: ${pendingRetries.length}, errored retries: ${erroredRetries.length}`)

		/** write out	retried records to db with flagged=null */
		const recordsToUpsert = [...pendingRetries, ...erroredRetries].map((r: TxRecord & { errorId?: string }): TxRecord => ({
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
	downloadTimeout: number,
}) => {
	const { indexName, pageNumber, metas, streamSourceName } = inputs
	/* invoke lambdas, retry on errors, return count */
	console.log(`${indexName} fnIngressInvoker starting for page ${pageNumber}`)
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

			const processed: FnIngressReturn = JSON.parse(new TextDecoder().decode(res.Payload as Uint8Array))

			console.info(indexName, fnIngressInvoker.name, `page ${pageNumber}, total records ${metas.length}, ${processed.numQueued} queued in s3, ${processed.numUpdated} inserts, ${processed.errored.length} errored.`, streamSourceName)

			return processed;
		} catch (err: unknown) {
			const e = err as Error
			await slackLog(indexName, fnIngressInvoker.name, `LAMBDA ERROR ${e.name}:${e.message}. retrying after 10 seconds...`, JSON.stringify(e))
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
