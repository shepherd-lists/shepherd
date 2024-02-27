import { Writable } from 'stream'
import { s3GetObjectStream, s3HeadObject } from 'libs/utils/s3-services'
import { readlineWeb } from 'libs/utils/webstream-utils'


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

let _current = {
	eTag: '',
	text: '',
	inProgress: false,
}

export const getAddresses = async (res: Writable) => {

	const returnCache = () => {
		console.info(getAddresses.name, `serving cache, ${_current.text.length} bytes.`)
		res.write(_current.text)
	}

	const eTag = (await s3HeadObject(process.env.LISTS_BUCKET!, 'addresses.txt')).ETag!
	console.debug(getAddresses.name, 'eTag', eTag)
	if (eTag === _current.eTag) {
		return returnCache()
	}

	/** just one fetch is needed, others can wait while a new fetch is occurring */
	if (_current.inProgress) {
		while (true) {
			await sleep(500) //wait for new cache
			if (!_current.inProgress) {
				return returnCache()
			}
		}
	}


	console.info(getAddresses.name, 'fetching new addresses.txt...')
	_current.inProgress = true

	const stream = await s3GetObjectStream(process.env.LISTS_BUCKET!, 'addresses.txt')
	let text = ''
	for await (const line of readlineWeb(stream)) {
		const l = `${line}\n`
		console.debug(l)
		text += l
		res.write(l)
	}
	console.info(getAddresses.name, `fetched new addresses.txt, ${text.length} bytes.`)
	_current = {
		eTag,
		text,
		inProgress: false,
	}
}