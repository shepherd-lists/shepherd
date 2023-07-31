import { logger } from '../common/shepherd-plugin-interfaces/logger'
import { RangelistAllowedItem } from './webserver-types'

const prefix = 'ipAllowLists'

/* load the IP access lists */
const accessBlacklist: string[] = JSON.parse(process.env.BLACKLIST_ALLOWED || '[]')
logger(prefix, `accessList (BLACKLIST_ALLOWED) for '/blacklist.txt' access`, accessBlacklist)
const accessRangelist: string[] = (JSON.parse(process.env.RANGELIST_ALLOWED || '[]') as RangelistAllowedItem[]).map(item => item.server)
logger(prefix, `accessList (RANGELIST_ALLOWED) for '/rangelist.txt' access`, accessRangelist)

export const ipAllowBlacklist = (ip: string) => {
	/* convert from `::ffff:192.0.0.1` => `192.0.0.1` */
	if (ip.startsWith("::ffff:")) {
		ip = ip.substring(7)
	}
	return accessBlacklist.includes(ip)
}

export const ipAllowRangelist = (ip: string) => {
	if (ip.startsWith("::ffff:")) {
		ip = ip.substring(7)
	}
	return accessRangelist.includes(ip)
}