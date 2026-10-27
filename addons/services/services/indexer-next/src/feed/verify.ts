import { createHash, createPublicKey, verify, constants } from 'node:crypto'
import { IncomingHttpHeaders } from 'node:http'


const DID_AR = 'uri-did-ar-'

/**
 * `keyid` of an Arweave address's `did-ar@1.0` committer: the address as a host label of no key type (`hb_committer:encode/2`).
 * the address in lowercase with `_` as `-`, then 9 base36 digits: one bit per character (1 for a capital or `_`), then 3 type bits.
 */
export const didArKeyid = (address: string) => {
	const bits = [...address].reduce((acc, c) => acc << 1n | BigInt(/[A-Z_]/.test(c)), 0n) << 3n
	return `${DID_AR}${address.toLowerCase().replaceAll('_', '-')}${bits.toString(36).padStart(9, '0')}`
}

/**
 * verify a HyperBEAM `httpsig@1.0` (RFC 9421) signed report.
 * returns the signer's address, or throws.
 * only `rsa-pss-sha512` signatures over non-derived components, covering `content-digest`.
 * the key is the `public-key` param and `keyid` is its `did-ar` committer.
 */
export const verifyReport = (headers: IncomingHttpHeaders, body: Buffer) => {
	const header = (name: string) => {
		const value = headers[name]
		if (typeof value !== 'string') throw new Error(`missing header ${name}`)
		return value
	}

	const digest = header('content-digest').match(/sha-256=:([^:]+):/)?.[1]
	if (digest !== createHash('sha256').update(body).digest('base64')) throw new Error('content-digest mismatch')

	const signatures = new Map([...header('signature').matchAll(/([a-z0-9_.*-]+)=:([^:]*):/g)].map(m => [m[1], Buffer.from(m[2], 'base64')]))

	for (const member of header('signature-input').split(/,\s*(?=[a-z][a-z0-9_.*-]*=\()/)) {
		const label = member.slice(0, member.indexOf('='))
		const paramsLine = member.slice(label.length + 1)
		const components = [...(paramsLine.match(/^\(([^)]*)\)/)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(m => m[1])
		const params = Object.fromEntries([...paramsLine.matchAll(/;([a-z0-9_.*-]+)=(?:"([^"]*)"|(-?\d+))/g)].map(m => [m[1], m[2] ?? m[3]]))
		const signature = signatures.get(label)

		if (params.alg !== 'rsa-pss-sha512' || !params.keyid?.startsWith(DID_AR) || !params['public-key'] || !signature) continue
		if (!components.includes('content-digest') || components.some(c => c.startsWith('@'))) continue

		const base = [...components.map(c => `"${c}": ${header(c)}`), `"@signature-params": ${paramsLine}`].join('\n')
		const n = Buffer.from(params['public-key'], 'base64url')
		const key = createPublicKey({ key: { kty: 'RSA', n: n.toString('base64url'), e: 'AQAB' }, format: 'jwk' })
		const address = createHash('sha256').update(n).digest('base64url')

		if (params.keyid !== didArKeyid(address)) throw new Error('keyid is not the committer of public-key')
		if (!verify('sha512', Buffer.from(base), { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 }, signature)) {
			throw new Error('invalid signature')
		}
		return address
	}
	throw new Error('no rsa-pss-sha512 signature')
}
