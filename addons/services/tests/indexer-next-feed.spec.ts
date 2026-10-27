import './_import-test-env-vars'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, generateKeyPairSync, randomBytes, sign, constants, KeyObject } from 'node:crypto'
import { Server } from 'node:http'
import pool from '../libs/utils/pgClient'
import { clearTimerHttpApiNodes } from '../libs/utils/update-range-nodes'
import { destroyGatewayAgent } from '../libs/chunkStreams/gatewayStream'
import { destroyMimeWorkers } from '../services/indexer-next/src/index-shared/ingress/downloadWithChecks'
import { ingressHandler } from '../services/indexer-next/src/index-shared/ingress/index'
import { didArKeyid, verifyReport } from '../services/indexer-next/src/feed/verify'

type GQLEdgeInterface = Parameters<typeof ingressHandler>[0]['metas'][number]


/** a real report, signed by a HyperBEAM node (throwaway wallet) and captured on the wire: `keyid="uri-did-ar-<label>";public-key="<key>"` */
const captured = JSON.parse(readFileSync(new URL('./assets/feed-report-did-ar.json', import.meta.url), 'utf8'))
const capturedBody = Buffer.from(captured.body, 'base64')
const capturedSigner = 'fPmDyhrlhy2AnV-kYjEEh3EvdfY64mJJEjtMKuQGegc'
const capturedItemId = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const capturedItemOwner = 'JcqPhOP1dNWcgISI-Y62vZz3kt2FKIN6_D7FUmWWFGA'

/** sign a report as HyperBEAM's httpsig@1.0 does. `keyid` defaults to the node's `did-ar` committer */
const testNode = () => {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
	const n = Buffer.from(publicKey.export({ format: 'jwk' }).n!, 'base64url')
	return { privateKey, address: createHash('sha256').update(n).digest('base64url'), n }
}
const signReport = (body: string, { privateKey, n, address }: { privateKey: KeyObject, n: Buffer, address: string }, keyid = didArKeyid(address)) => {
	const digest = `sha-256=:${createHash('sha256').update(body).digest('base64')}:`
	const params = `("content-digest" "content-type");alg="rsa-pss-sha512";keyid="${keyid}";public-key="${n.toString('base64url')}"`
	const base = `"content-digest": ${digest}\n"content-type": application/json\n"@signature-params": ${params}`
	const signature = sign('sha512', Buffer.from(base), { key: privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 })
	return {
		'content-type': 'application/json',
		'content-digest': digest,
		'signature-input': `comm-test=${params}`,
		'signature': `comm-test=:${signature.toString('base64')}:`,
	}
}

const meta = (id: string, size: string, height: number | null) => ({
	cursor: '',
	node: { id, data: { size, type: 'image/png' }, tags: [], owner: { address: 'x'.repeat(43), key: '' }, block: height === null ? null : { height }, parent: null },
}) as unknown as GQLEdgeInterface
const ingest = (metas: GQLEdgeInterface[], downloadTimeout = 90_000) => ingressHandler({ metas, pageNumber: 'test', gqlProvider: 'test', indexName: 'test', streamSourceName: 'gateway', downloadTimeout })
const newId = () => randomBytes(32).toString('base64url')
const sum = (results: Awaited<ReturnType<typeof ingest>>[], f: (r: Awaited<ReturnType<typeof ingest>>) => number) => results.reduce((acc, r) => acc + f(r), 0)


describe('feed verify', () => {

	it('should verify a real HyperBEAM report and return its signer', () => {
		assert.equal(verifyReport(captured.headers, capturedBody), capturedSigner)
	})

	it('should give the did-ar keyid of an address as HyperBEAM does', () => {
		assert.equal(didArKeyid('kY9RAgTJEImkBpiKgVeXrsGV02T-D4dI3ZvSpnn7HSk'), 'uri-did-ar-ky9ragtjeimkbpikgvexrsgv02t-d4di3zvspnn7hsk8xyj2kegg') //hb_committer doc
		assert.equal(didArKeyid('-r-OiFD1vOJMcltGY9QFCvCA6w3i3STZCzwe3Q_fD70'), 'uri-did-ar--r-oifd1vojmcltgy9qfcvca6w3i3stzczwe3q-fd7026q742gtc') //captured
	})

	it('should reject a keyid that is not the did-ar committer of public-key', () => {
		const body = JSON.stringify({ items: [] })
		const [node, other] = [testNode(), testNode()]
		assert.equal(verifyReport(signReport(body, node), Buffer.from(body)), node.address)
		assert.throws(() => verifyReport(signReport(body, node, didArKeyid(other.address)), Buffer.from(body)), /keyid is not the committer/)
		for (const keyid of [`did:pkh:arweave:7wIU:${node.address}`, `publickey:${node.n.toString('base64')}`]) {
			assert.throws(() => verifyReport(signReport(body, node, keyid), Buffer.from(body)), /no rsa-pss-sha512 signature/)
		}
	})

	it('should reject a report with one body byte changed', () => {
		const body = Buffer.from(capturedBody)
		body[body.length - 3] ^= 1
		assert.throws(() => verifyReport(captured.headers, body), /content-digest mismatch/)
	})

	it('should reject a changed body even with a matching content-digest', () => {
		const body = Buffer.from(capturedBody.toString().replace('"16"', '"17"'))
		const headers = { ...captured.headers, 'content-digest': `sha-256=:${createHash('sha256').update(body).digest('base64')}:` }
		assert.throws(() => verifyReport(headers, body), /invalid signature/)
	})
})


describe('feed server', () => {

	const node = testNode()
	const stranger = testNode()
	const url = 'http://127.0.0.1:85/feed'
	let server: Server

	before(async () => {
		process.env.HB_FEED_NODES = JSON.stringify({ [capturedSigner]: 'captured', [node.address]: 'test' })
		server = (await import('../services/indexer-next/src/feed/server')).feedServer()
		await pool.query(`DELETE FROM txs WHERE txid = $1`, [capturedItemId])
	})
	after(async () => {
		server.close()
		await pool.query(`DELETE FROM txs WHERE txid = $1`, [capturedItemId])
	})

	const post = (headers: Record<string, string>, body: string | Buffer) => fetch(url, { method: 'POST', headers, body: new Uint8Array(Buffer.from(body)) })
	const capturedHeaders = () => Object.fromEntries(['content-type', 'content-digest', 'signature-input', 'signature'].map(h => [h, captured.headers[h]]))

	it('should 401 a tampered report', async () => {
		const body = Buffer.from(capturedBody.toString().replace('"16"', '"17"'))
		assert.equal((await post(capturedHeaders(), body)).status, 401)
	})

	it('should 403 a report signed by a node not in feed_nodes', async () => {
		const body = JSON.stringify({ items: [] })
		assert.equal((await post(signReport(body, stranger), body)).status, 403)
	})

	it('should 401 an unsigned report', async () => {
		assert.equal((await post({ 'content-type': 'application/json' }, JSON.stringify({ items: [] }))).status, 401)
	})

	it('should 400 a malformed report', async () => {
		for (const body of ['not json', JSON.stringify({ items: [{ id: `'); DROP TABLE txs; --`, data: { size: '1' }, tags: [], owner: { key: '' } }] })]) {
			assert.equal((await post(signReport(body, node), body)).status, 400)
		}
	})

	it('should 202 the real report and store its item with null height and canonical owner', async () => {
		assert.equal((await post(capturedHeaders(), capturedBody)).status, 202)

		let row
		for (let i = 0; i < 50 && !row; i++) {
			await new Promise(resolve => setTimeout(resolve, 100))
			row = (await pool.query(`SELECT * FROM txs WHERE txid = $1`, [capturedItemId])).rows[0]
		}
		assert.ok(row, 'should have stored the item')
		assert.equal(row.height, null)
		assert.equal(row.owner, capturedItemOwner)
		assert.equal(row.data_reason, 'negligible-data')
	})
})


describe('ingress duplicates', () => {

	const ids: string[] = []
	after(async () => {
		await pool.query(`DELETE FROM txs WHERE txid = ANY($1)`, [ids])
		await pool.end()
		destroyGatewayAgent()
		clearTimerHttpApiNodes()
		await destroyMimeWorkers()
	})

	it('should not re-ingest a null-height row for an edge with a height', async () => {
		const id = newId()
		ids.push(id)
		assert.equal((await ingest([meta(id, '100', null)])).numUpdated, 1)
		assert.equal((await ingest([meta(id, '100', 100)])).numUpdated, 0)
	})

	it('should still re-ingest a row for an edge with a newer height', async () => {
		const id = newId()
		ids.push(id)
		assert.equal((await ingest([meta(id, '100', 50)])).numUpdated, 1)
		assert.equal((await ingest([meta(id, '100', 100)])).numUpdated, 1)
	})

	it('should download a page once when two ingests take it concurrently', async () => {
		const id = 'SUIycDyPfSqkkYunexGcGXjjhujc4rM5KHUz9NP-JBI' //small image data-item
		await pool.query(`DELETE FROM txs WHERE txid = $1`, [id])
		const results = await Promise.all([ingest([meta(id, '19371', null)]), ingest([meta(id, '19371', null)])])
		assert.equal(sum(results, r => r.numQueued), 1)
		assert.equal(sum(results, r => r.numUpdated + r.errored.length), 0)
	})

	it('should release the claim of a timed-out record', async () => {
		const id = newId()
		const first = await ingest([meta(id, '100000', null)], 1)
		assert.equal(first.errored.length, 1)
		const second = await ingest([meta(id, '100000', null)], 1)
		assert.equal(second.errored.length, 1, 'should have been taken again, not skipped as claimed')
	})
})
