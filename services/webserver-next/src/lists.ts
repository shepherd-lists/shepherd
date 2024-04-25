import { PassThrough, Writable } from 'stream'
import { s3GetObjectWebStream, s3HeadObject } from '../../../libs/utils/s3-services'
import { readlineWeb } from '../../../libs/utils/webstream-utils'

if (!process.env.LISTS_BUCKET) throw new Error('missing env var, LISTS_BUCKET')
console.debug('LISTS_BUCKET', process.env.LISTS_BUCKET)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface Cached {
	eTag: string;
	text: string;
	inProgress: boolean;
}
const _cache: Record<string, Cached> = {}

export type GetListPath = ('/addresses.txt' | '/blacklist.txt' | '/rangelist.txt' | '/rangeflagged.txt' | '/rangeowners.txt' | '/testing.txt')

export const getETag = (path: GetListPath) => _cache[path].eTag

export const getList = async (res: Writable, path: GetListPath) => {

	const key = path.replace('/', '')

	/** init cache if necessary */
	if (!_cache[path]) {
		_cache[path] = {
			eTag: '',
			text: '',
			inProgress: false,
		}
	}

	const returnCache = () => {
		console.info(`${getList.name}(${path})`, `serving cache, ${_cache[path].text.length} bytes.`)
		res.write(_cache[path].text)
	}

	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, key)).ETag!
	console.debug(`${getList.name}(${path})`, 'eTag', eTag)
	if (eTag === _cache[path].eTag) {
		return returnCache()
	}

	/** just one fetch is needed, others can wait while a new fetch is occurring */
	if (_cache[path].inProgress) {
		while (_cache[path].inProgress) {
			await sleep(500) //wait for new cache
		}
		return returnCache()
	}


	console.info(`${getList.name}(${path})`, 'fetching new...')
	_cache[path].inProgress = true

	const stream = await s3GetObjectWebStream(process.env.LISTS_BUCKET!, key)
	let text = ''
	for await (const line of readlineWeb(stream)) {
		const l = `${line}\n`
		// console.debug(l)
		text += l
		res.write(l)
	}
	console.info(`${getList.name}(${path})`, `fetched ${text.length} bytes.`)
	_cache[path] = {
		eTag,
		text,
		inProgress: false,
	}
}

export const prefetchLists = async () => {
	await Promise.all(['/addresses.txt', '/blacklist.txt', '/rangelist.txt', '/rangeflagged.txt', '/rangeowners.txt'].map(async path => {
		const dummy = new PassThrough()
		await getList(dummy, path as GetListPath)
		dummy.destroy()
	}))
}
