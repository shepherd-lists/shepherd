import { RangelistAllowedItem } from './webserver-types'
import { Request, Response, NextFunction } from 'express'

const prefix = 'ipAllowLists'

/* load the IP access lists */
const accessBlacklist: string[] = JSON.parse(process.env.BLACKLIST_ALLOWED || '[]')
console.info(prefix, 'accessList (BLACKLIST_ALLOWED) for \'/blacklist.txt\' access', accessBlacklist)
const accessRangelist: string[] = (JSON.parse(process.env.RANGELIST_ALLOWED || '[]') as RangelistAllowedItem[]).map(item => item.server)
console.info(prefix, 'accessList (RANGELIST_ALLOWED) for \'/rangelist.txt\' access', accessRangelist)

/** older ip whitelist checking functions */

export const ipAllowBlacklist = (ip: string) => ipAllowList(ip, 'txids')

export const ipAllowRangelist = (ip: string) => ipAllowList(ip, 'ranges')

const ipAllowList = (ip: string, listType: ('txids' | 'ranges')) => {
	if (ip.startsWith('::ffff:')) {
		ip = ip.substring(7)
	}
	const whitelist = listType === 'txids' ? accessBlacklist : accessRangelist
	return whitelist.includes(ip)
}

/** handle ip whitelising as middleware */

/**
 * uff. this is madness. clean all this up.
 */

export const ipAllowTxidsMiddleware = (req: Request, res: Response, next: NextFunction) => ipAllowMiddlewareFunction('txids')(req, res, next)

export const ipAllowRangesMiddleware = (req: Request, res: Response, next: NextFunction) => ipAllowMiddlewareFunction('ranges')(req, res, next)

const ipAllowMiddlewareFunction = (listType: ('txids' | 'ranges')) => (req: Request, res: Response, next: NextFunction) => {
	const routepath = req.route.path
	const ip = req.headers['x-forwarded-for'] as string || 'undefined'
	if (
		(listType === 'txids' && accessBlacklist.length > 0)
		|| (listType === 'ranges' && accessRangelist.length > 0)
	) {
		if (ipAllowList(ip, listType)) {
			console.info(prefix, `access ${routepath} list: ${ip} ALLOWED`)
			next()
		} else {
			console.info(prefix, `access ${routepath} list: ${ip} DENIED`)
			res.setHeader('eTag', 'denied')
			res.status(403).send('403 Forbidden')
		}
	} else {
		next()
	}
}
