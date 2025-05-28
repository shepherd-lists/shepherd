import { PassThrough, Writable } from 'stream'
import { s3GetObjectWebStream, s3HeadObject } from '../../../libs/utils/s3-services'
import { readlineWeb } from '../../../libs/utils/webstream-utils'
import { addonTxsTableNames } from '../../../libs/utils/addon-tablenames'

if (!process.env.LISTS_BUCKET) throw new Error('missing env var, LISTS_BUCKET')
console.debug('LISTS_BUCKET', process.env.LISTS_BUCKET)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface Cached {
	eTag: string;
	text: string;
	inProgress: boolean;
}
const _cache: Record<string, Cached> = {}

export type GetListPath = ('/addresses.txt'
	| '/blacklist.txt'	//concat txidflagged + txidowners
	| '/txidflagged.txt'
	| '/txidowners.txt'
	| '/rangelist.txt'
	| '/rangeflagged.txt'	//needed for shep-v
	| '/rangeowners.txt'	//needed for shep-v
	| '/testing.txt'
	| `${string}/txids.txt`		//addons
	| `${string}/ranges.txt`	//addons
)

export const getETag = async (path: GetListPath) => {
	const key = path.replace(/^\//, '') //remove starting `/`
	const etag = (await s3HeadObject(process.env.LISTS_BUCKET!, key)).ETag!
	console.info(`${getETag.name}(${path}) head request. etag: ${etag}`)
	return etag
}

export const getList = async (response: Writable, path: GetListPath) => {
	const res = response as Writable & {
		setHeader?: (k: string, v: string) => void
		getHeader: (name: string) => string
	}

	const key = path.replace(/^\//, '') //starting `/` only

	/** init cache if necessary */
	if (!_cache[path]) {
		_cache[path] = {
			eTag: '',
			text: '',
			inProgress: false,
		}
	}

	const returnCache = () => {
		let txt = ''
		if (path === '/blacklist.txt') {
			txt = _cache['/txidflagged.txt'].text + _cache['/txidowners.txt'].text
		} else {
			txt = _cache[path].text
		}
		console.info(`${getList.name}(${path})`, `serving cache, ${txt.length} bytes.`)
		if (typeof res.setHeader === 'function') res.setHeader('eTag', _cache[path].eTag)
		res.write(txt)
		return txt
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
	/** etag needs to be set before content is written. also may be combining getList calls */
	if (typeof res.setHeader === 'function' && !res.getHeader('eTag')) res.setHeader('eTag', eTag)

	let text = ''
	if (['/blacklist.txt'].includes(path)) {
		text = await getList(res, '/txidflagged.txt')
		text += await getList(res, '/txidowners.txt')
		_cache['/blacklist.txt'] = {
			eTag,
			text: '',	//we're saving ram
			inProgress: false,
		}
	} else {
		const stream = await s3GetObjectWebStream(process.env.LISTS_BUCKET!, key)
		for await (const line of readlineWeb(stream)) {
			const l = `${line}\n`
			// console.debug(l)
			text += l
			res.write(l)
		}
		_cache[path] = {
			eTag,
			text,
			inProgress: false,
		}
	}

	console.info(`${getList.name}(${path})`, `fetched ${text.length} bytes.`)
	return text
}


export const prefetchLists = async () => {
	console.info('prefetching lists...')
	const routes = ['/addresses.txt', '/blacklist.txt', '/rangelist.txt']
	const addonPaths = (await addonTxsTableNames()).map(tablename => tablename.replace('_txs', ''))
	addonPaths.map(addonPath => {
		routes.push(`/${addonPath}/txids.txt`)
		routes.push(`/${addonPath}/ranges.txt`)
	})

	await Promise.all(routes.map(async path => {
		const dummy = new PassThrough()
		await getList(dummy, path as GetListPath)
		dummy.destroy()
	}))
	console.info('prefetching lists done.')
}
