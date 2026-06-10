import './_import-test-env-vars'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
	DEFAULT_INGEST_INTERVALS,
	ingestLagMode,
	pickIngestInterval,
} from '../services/indexer-next/src/index-by-ingested_at'


describe('pickIngestInterval', () => {
	const { liveIntervalSec, backsyncIntervalSec, backsyncLagThresholdSec } = DEFAULT_INGEST_INTERVALS

	it('uses backsync interval when lag is greater than 1 hour', () => {
		const nowSec = 2_000_000
		const positionSec = nowSec - backsyncLagThresholdSec - 1
		assert.equal(
			pickIngestInterval({ nowSec, positionSec, liveIntervalSec, backsyncIntervalSec, backsyncLagThresholdSec }),
			backsyncIntervalSec,
		)
		assert.equal(ingestLagMode(nowSec - positionSec, backsyncLagThresholdSec), 'backsync')
	})

	it('uses live interval when lag is at most 1 hour', () => {
		const nowSec = 2_000_000
		const positionSec = nowSec - backsyncLagThresholdSec
		assert.equal(
			pickIngestInterval({ nowSec, positionSec, liveIntervalSec, backsyncIntervalSec, backsyncLagThresholdSec }),
			liveIntervalSec,
		)
		assert.equal(ingestLagMode(nowSec - positionSec, backsyncLagThresholdSec), 'live')
	})

	it('uses live interval when lag is below threshold', () => {
		const nowSec = 2_000_000
		const positionSec = nowSec - 60
		assert.equal(
			pickIngestInterval({ nowSec, positionSec, liveIntervalSec, backsyncIntervalSec, backsyncLagThresholdSec }),
			liveIntervalSec,
		)
	})
})
