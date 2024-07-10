import http from 'http'
import https from 'https'


export const checkReachable = async (url: string) => new Promise<boolean>(resolve => {
	const protocol = url.startsWith('https') ? https : http
	const req = protocol.request(url, { method: 'HEAD', timeout: 10_000 },
		res => {
			const { statusCode, statusMessage } = res
			if (statusCode !== 200) console.info(`${url} ${statusCode} ${statusMessage}`)
			resolve(statusCode === 200 ? true : false)
			res.on('data', () => { }) //must use up empty stream
		}
	)
	req.on('error', (err) => {
		console.error(checkReachable.name, 'error', `${url} ${err.name}:${err.message}`)
		resolve(false)
		req.destroy()
	})
	const timeoutHandler = () => {
		resolve(false)
		req.destroy() //also calls error but takes some time
	}
	req.setTimeout(2_000, timeoutHandler)
	req.on('timeout', timeoutHandler)
	req.end()
})


// checkReachable('https://arweave.net/info').then(console.info)
// checkReachable('https://arweave.dev/info').then(console.info)
// checkReachable('http://1.1.1.1').then(console.info) //returns 30x, so false

