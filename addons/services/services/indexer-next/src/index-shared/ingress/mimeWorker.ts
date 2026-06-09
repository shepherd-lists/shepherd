import { spawn } from 'node:child_process'
import { parentPort } from 'node:worker_threads'

if (!parentPort) throw new Error('mimeWorker must be run as a worker thread')
const port = parentPort

interface Request { id: number; buffer: ArrayBuffer }

/** detect MIME via libmagic by piping a sample to `file` over stdin (no disk I/O).
 * Verbatim port of the previous in-process detectMime, now running off the main
 * thread so the synchronous spawn/fork syscall no longer blocks the event loop.
 *
 * The `file` child process is an intentional isolation boundary: the sample is
 * untrusted weave data, so libmagic must run out-of-process. Do not replace this
 * with an in-process native binding. */
const detectMime = (sample: Buffer): Promise<string> => new Promise((resolve, reject) => {
	const proc = spawn('file', ['--mime-type', '-b', '-'])
	let stdout = ''
	let stderr = ''
	proc.stdout.on('data', d => { stdout += d })
	proc.stderr.on('data', d => { stderr += d })
	proc.on('error', reject) // e.g. `file` not installed
	proc.on('close', code => {
		if (code !== 0) return reject(new Error(`file exited ${code}: ${stderr.trim()}`))
		resolve(stdout.trim())
	})
	// EPIPE just means `file` exited before we finished writing the sample; the exit
	// code (via 'close') is the real verdict, so swallow EPIPE, surface other errors.
	proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
		if (err.code !== 'EPIPE') reject(err)
	})
	proc.stdin.end(sample)
})

port.on('message', async ({ id, buffer }: Request) => {
	try {
		const mime = await detectMime(Buffer.from(buffer))
		port.postMessage({ id, mime })
	} catch (err) {
		port.postMessage({ id, error: (err as Error).message })
	}
})
