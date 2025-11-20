import { s3HeadObject, s3ObjectTagging, s3PutObject } from '../utils/s3-services'
import { slackLog } from '../utils/slackLog'
import pool from '../utils/pgClient'


const LISTS_BUCKET = process.env.LISTS_BUCKET as string


export const keyExists = async (key: string) => {
	try {
		await s3HeadObject(LISTS_BUCKET, key)
		return true
	} catch (err) {
		const e = err as Error
		if (['NoSuchKey', 'NotFound'].includes((e.name))) {
			return false
		} else {
			slackLog(keyExists.name, `${e.name}:${e.message}`, JSON.stringify(e))
			throw new Error(`unexpected error`, { cause: e })
		}
	}
}
export const s3GetTag = async (objectKey: string, tagKey: string) => {
	try {
		const tagging = await s3ObjectTagging(LISTS_BUCKET, objectKey)
		return tagging.TagSet?.find(tag => tag.Key === tagKey)!.Value as string
	} catch (e) {
		if (['NoSuchKey', 'NotFound', 'MethodNotAllowed'].includes(((e as Error).name)))
			return 'undefined'
		await slackLog(s3GetTag.name, objectKey, tagKey, String(e))
		throw new Error(`unexpected error`, { cause: e })
	}
}

const ownersFromDb = async () => {
	/** addresses should be pretty small, otherwise we might use streams. order for hashing */
	let { rows } = await pool.query(
		`SELECT owners_list.owner FROM owners_list
			LEFT JOIN owners_whitelist ON owners_list.owner = owners_whitelist.owner
			WHERE owners_whitelist IS NULL
			AND (add_method = 'manual' OR add_method = 'blocked')
			ORDER BY owners_list.owner ASC`
	)
	const owners = rows.map((row: { owner: string }) => row.owner)
	return owners
}
const textHash = async (text: string) => {
	const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
	return Array.from(new Uint8Array(hashBuffer)).map((b: any) => b.toString(16).padStart(2, '0')).join('')
}

/** /addresses.txt never became an output, but use it interally. */
export const updateAddresses = async () => {
	try {

		const owners = await ownersFromDb()

		/** check if an update is actually required */
		const actualHash = await textHash(owners.join('\n') + '\n')
		const s3Hash = await s3GetTag('addresses.txt', 'SHA-1')
		if (actualHash === s3Hash) {
			console.info(updateAddresses.name, `not updating, hash for addresses.txt matches:\n${actualHash}\n${s3Hash}`)
			return false
		}

		console.info(updateAddresses.name, `updating addresses.txt... hash:${actualHash}, length:${owners.length}`, JSON.stringify(owners))

		await s3PutObject({ Bucket: process.env.LISTS_BUCKET!, Key: 'addresses.txt', text: owners.join('\n') + '\n', Sha1: actualHash })


		return owners.length

	} catch (err: unknown) {
		const e = err as Error
		slackLog(updateAddresses.name, `${e.name}:${e.message}`, JSON.stringify(e))
		throw e;
	}
}

