/*
 * Once-off bulk replay from inbox-records.json into S3 via processRecord.
 *
 * Notes:
 * - This writes real objects and triggers objectCreated queue side effects.
 * - Progress is checkpointed in this directory so a rerun resumes unfinished txids.
 * - No CLI/env knobs: tune constants below in-file if needed for this one-off run.
 *
 * Usage:
 *   cd addons/services
 *   npx tsx tools/insert-inbox-records-to-s3.ts
 */
import 'dotenv/config'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import pLimit from 'p-limit'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { destroyGatewayAgent } from '../libs/chunkStreams/gatewayStream'
import { destroyChunkStreamAgent } from '../libs/chunkStreams/chunkFetch'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { processRecord, destroyMimeWorkers } from '../services/indexer-next/src/index-shared/ingress/downloadWithChecks'

type InboxRecord = {
	txid: string
	content_size: string | number
	parent?: string | null
	parents?: string[] | null
	[key: string]: unknown
}

type ProgressEntry = {
	txid: string
	queued: boolean
	attempts: number
	source: 'chunk' | 'gateway'
	errorId?: string
	dataReason?: string
	ts: string
}

const CONCURRENCY = 5
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 1_000
const PROGRESS_LOG_INTERVAL_MS = 10_000

const RECORDS_PATH = new URL('./inbox-records.json', import.meta.url)
const PROGRESS_PATH = new URL('./insert-inbox-records.progress.jsonl', import.meta.url)
const FAILED_PATH = new URL('./insert-inbox-records.failed.jsonl', import.meta.url)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const normalizeRecord = (record: InboxRecord): TxRecord => ({
	...(record as Record<string, unknown>),
	txid: String(record.txid),
	content_size: String(record.content_size),
	parent: record.parent ?? null,
	parents: Array.isArray(record.parents) ? record.parents : undefined,
} as TxRecord)

const readJsonLines = <T>(file: URL): T[] => {
	if (!existsSync(file)) return []
	const content = readFileSync(file, 'utf-8').trim()
	if (!content) return []

	return content
		.split('\n')
		.flatMap((line, index) => {
			try {
				return [JSON.parse(line) as T]
			} catch (e) {
				console.warn(`Skipping malformed JSONL line ${index + 1} in ${file.pathname}:`, String(e))
				return []
			}
		})
}

const appendJsonLine = (file: URL, data: unknown) => {
	appendFileSync(file, `${JSON.stringify(data)}\n`, 'utf-8')
}

const processWithRetry = async (record: TxRecord): Promise<ProgressEntry> => {
	let attempt = 0

	while (attempt < MAX_ATTEMPTS) {
		attempt += 1
		const source: ProgressEntry['source'] = 'chunk'

		console.info(`[${record.txid}] attempt ${attempt}/${MAX_ATTEMPTS} using ${source} stream`)
		const result = await processRecord(record, new AbortController().signal)
		const hasRetryableError = result.errorId != null
		const normalizedErrorId = result.errorId

		if (result.queued) {
			return {
				txid: record.txid,
				queued: true,
				attempts: attempt,
				source,
				ts: new Date().toISOString(),
			}
		}

		if (!hasRetryableError) {
			return {
				txid: record.txid,
				queued: false,
				attempts: attempt,
				source,
				dataReason: result.record.data_reason,
				ts: new Date().toISOString(),
			}
		}

		if (attempt === MAX_ATTEMPTS) {
			return {
				txid: record.txid,
				queued: false,
				attempts: attempt,
				source,
				errorId: normalizedErrorId,
				dataReason: result.record.data_reason,
				ts: new Date().toISOString(),
			}
		}

		const backoffMs = BASE_BACKOFF_MS * 2 ** (attempt - 1)
		console.warn(`[${record.txid}] retryable error "${normalizedErrorId}", retrying in ${backoffMs}ms`)
		await sleep(backoffMs)
	}

	throw new Error(`retry loop exhausted unexpectedly for ${record.txid}`)
}

const main = async () => {
	const existingProgress = readJsonLines<ProgressEntry>(PROGRESS_PATH)
	const doneTxids = new Set(existingProgress.map(r => r.txid))

	const raw = JSON.parse(readFileSync(RECORDS_PATH, 'utf-8')) as InboxRecord[]
	if (!Array.isArray(raw)) throw new Error(`Expected array in ${RECORDS_PATH.pathname}`)

	const records = raw.map(normalizeRecord)
	const pending = records.filter(r => !doneTxids.has(r.txid))

	console.info(`Loaded ${records.length} records from inbox file`)
	console.info(`Already completed: ${doneTxids.size}`)
	console.info(`Pending this run: ${pending.length}`)

	if (pending.length === 0) {
		console.info('Nothing to do. All records were already processed.')
		return
	}

	const limit = pLimit(CONCURRENCY)
	const totals = {
		queued: 0,
		failed: 0,
		retriedSuccess: 0,
		retryExhausted: 0,
		nonRetryable: 0,
	}

	let inFlight = 0
	let completed = 0
	const t0 = Date.now()

	const progressTimer = setInterval(() => {
		const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1)
		console.info(
			`progress elapsed=${elapsedSec}s completed=${completed}/${pending.length} inFlight=${inFlight} queued=${totals.queued} failed=${totals.failed}`
		)
	}, PROGRESS_LOG_INTERVAL_MS)

	try {
		await Promise.all(pending.map(record => limit(async () => {
			inFlight += 1
			try {
				const summary = await processWithRetry(record)
				appendJsonLine(PROGRESS_PATH, summary)
				completed += 1
				const status = summary.queued ? 'UPLOADED_TO_S3' : 'PROCESSED_NOT_UPLOADED'
				const reason = summary.errorId?.trim() || summary.dataReason || 'none'
				console.info(
					[
						'',
						'============================================================',
						'==================== RECORD PROCESSED ======================',
						`status=${status}`,
						`txid=${summary.txid} attempts=${summary.attempts} source=${summary.source} reason=${reason}`,
						'============================================================',
						'',
					].join('\n')
				)

				if (summary.queued) {
					totals.queued += 1
					if (summary.attempts > 1) totals.retriedSuccess += 1
					return
				}

				totals.failed += 1
				if (summary.errorId) totals.retryExhausted += 1
				else totals.nonRetryable += 1
				appendJsonLine(FAILED_PATH, summary)
			} finally {
				inFlight -= 1
			}
		})))
	} finally {
		clearInterval(progressTimer)
	}

	const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1)
	console.info('===== bulk inbox replay complete =====')
	console.info(`elapsed: ${elapsedSec}s`)
	console.info(`processed this run: ${completed}`)
	console.info(`queued: ${totals.queued}`)
	console.info(`failed: ${totals.failed}`)
	console.info(`retried success: ${totals.retriedSuccess}`)
	console.info(`retry exhausted: ${totals.retryExhausted}`)
	console.info(`non-retryable: ${totals.nonRetryable}`)
	console.info(`progress file: ${PROGRESS_PATH.pathname}`)
	console.info(`failed file: ${FAILED_PATH.pathname}`)
}

try {
	await main()
} finally {
	// teardown shared resources so the process exits cleanly after long runs
	destroyGatewayAgent()
	destroyChunkStreamAgent()
	destroyMimeWorkers()
	clearTimerHttpApiNodes()
}
