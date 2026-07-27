import { Worker } from 'node:worker_threads'
import { availableParallelism } from 'node:os'

/**
 * Pool of worker threads that run `file`/libmagic MIME detection. The blocking
 * spawn/fork syscall happens inside the workers, keeping the main event loop
 * free. Verdicts are byte-identical to the previous in-process implementation.
 *
 * Lazy singleton: created on first detectMime() call, lives for the process
 * lifetime, and unref()'d so it never keeps the process alive. Tests/tools call
 * destroyMimeWorkers() to tear it down cleanly.
 */

interface Pending { resolve: (mime: string) => void; reject: (err: Error) => void }
interface Reply { id: number; mime?: string; error?: string }

const POOL_SIZE = Math.max(2, Math.min(4,
	Number(process.env.MIME_WORKERS) || availableParallelism() - 1
))

const workerUrl = new URL('./mimeWorker.ts', import.meta.url)

let workers: Worker[] | null = null
let nextWorker = 0
let nextId = 0
const pending = new Map<number, Pending>()

/** The pool is ref'd only while requests are in flight: idle it never holds the
 * process open, but an in-flight detectMime() can't be cut short by the process
 * exiting out from under it (which an all-unref'd pool allows whenever nothing
 * else refs the loop — e.g. tools/tests, leaving the await unsettled forever). */
const syncPoolRef = () => {
	if (!workers) return
	for (const w of workers) pending.size > 0 ? w.ref() : w.unref()
}

const getWorkers = (): Worker[] => {
	if (workers) return workers
	workers = Array.from({ length: POOL_SIZE }, () => {
		// execArgv passes the tsx loader so the .ts worker entry loads correctly
		const w = new Worker(workerUrl, { execArgv: ['--import', 'tsx'] })
		w.on('message', ({ id, mime, error }: Reply) => {
			const p = pending.get(id)
			if (!p) return
			pending.delete(id)
			syncPoolRef()
			if (error !== undefined) p.reject(new Error(error))
			else p.resolve(mime!)
		})
		w.on('error', err => {
			// a worker crash fails its in-flight requests rather than hanging them
			for (const [id, p] of pending) { pending.delete(id); p.reject(err) }
			syncPoolRef()
		})
		w.unref()
		return w
	})
	return workers
}

/** detect MIME via a pooled worker. Same signature as the old in-process fn. */
export const detectMime = (sample: Buffer): Promise<string> => {
	const pool = getWorkers()
	const worker = pool[nextWorker++ % pool.length]
	const id = nextId++
	// copy into an exact, standalone (non-shared) ArrayBuffer so we transfer only these bytes
	const buffer = new ArrayBuffer(sample.byteLength)
	new Uint8Array(buffer).set(sample)
	return new Promise<string>((resolve, reject) => {
		pending.set(id, { resolve, reject })
		syncPoolRef()
		worker.postMessage({ id, buffer }, [buffer])
	})
}

/** terminate all workers and reset the pool (e.g. in test teardown). */
export const destroyMimeWorkers = async (): Promise<void> => {
	if (!workers) return
	const toClose = workers
	workers = null
	for (const [id, p] of pending) { pending.delete(id); p.reject(new Error('mime workers destroyed')) }
	await Promise.all(toClose.map(w => w.terminate()))
}
