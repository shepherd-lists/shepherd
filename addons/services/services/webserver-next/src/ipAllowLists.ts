import { Request, Response, NextFunction } from 'express'
import { rangeAllowedIps } from '../../../libs/utils/update-range-nodes'

const prefix = 'ipAllowLists'

/* load the IP access lists */
const accessBlacklist: string[] = JSON.parse(process.env.BLACKLIST_ALLOWED || '[]')
console.info(prefix, 'accessList (BLACKLIST_ALLOWED) for \'/blacklist.txt\' access', accessBlacklist)
let accessRangelist = rangeAllowedIps()
console.info(prefix, 'accessList (RANGELIST_ALLOWED+http_api_nodes_url) for \'/rangelist.txt\' access', accessRangelist)

const ipAllowList = (ip: string, listType: ('txids' | 'ranges')) => {
	if (ip.startsWith('::ffff:')) {
		ip = ip.substring(7)
	}
	const whitelist = listType === 'txids' ? accessBlacklist : accessRangelist

	if (whitelist.length === 0) return true //empty list means bypass

	return whitelist.includes(ip)
}

/** handle ip whitelising as middleware */

export const ipAllowMiddleware = (listType: ('txids' | 'ranges')) => (req: Request, res: Response, next: NextFunction) => {
	const path = req.path
	const ip = req.headers['x-forwarded-for'] as string || 'undefined'
	accessRangelist = rangeAllowedIps()

	if (ipAllowList(ip, listType)) {
		console.info(prefix, `access ${path} list: ${ip} ALLOWED`)
		next()
	} else {
		console.info(prefix, `access ${path} list: ${ip} DENIED`)
		res.setHeader('eTag', 'denied')
		res.status(403).send('403 Forbidden')
	}
}
