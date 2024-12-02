import { createWriteStream, readFileSync } from 'fs'
import { TxRecord, TxScanned } from 'shepherd-plugin-interfaces/types'
import { finished } from 'stream/promises'
import pLimit from 'p-limit'

const MAX_FETCHES = 100
const limit = pLimit(MAX_FETCHES)

// basic argument checking
if (process.argv.length > 2) {
	const args = process.argv.slice(2)
	console.log('Received arguments:', args)
} else {
	console.log('Usage: npx tsx determine-uncached.ts txids.txt')
	process.exit(1)
}

/** read in txids.txt */
const txids = readFileSync(process.argv[2], 'utf8').split('\n')
txids.pop() //last empty
console.debug(txids.length)

/** prepate write stream */
const out = createWriteStream('uncached-txids.txt', 'utf-8')

let batch = txids.splice(0, Math.min(100, txids.length))
let writeCount = 0
let readCount = 0

while (batch.length > 0) {
	await Promise.all(batch.map(async id => {
		++readCount
		while (true) {
			try {

				const res = await fetch(`https://arweave.net/raw/${id}`)
				console.debug(id, res.status, readCount)

				if (!res.bodyUsed) res.body?.cancel() //close stream

				if (res.status === 404) {
					console.debug('write', id, 'to file')
					++writeCount
					out.write(id + '\n')
				} else if (res.status === 200) {
					//do nothing
				} else {
					//big stop
					throw new Error(`UNHANDLED STATUS ${JSON.stringify({ id, readCount, writeCount, status: res.status, statusText: res.statusText })}`)
				}
				break;
			} catch (e) {
				console.error('error', id, e, '\nRETRYING!')
			}
		}
	}))
	batch = txids.splice(0, Math.min(100, txids.length))

}

out.end()
await finished(out)
console.info(`done writing ${writeCount} to uncached-txids.txt`)
process.exit()
