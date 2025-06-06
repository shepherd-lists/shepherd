import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import { idToBas32 } from '../libs/utils/id-to-base32'



describe('base32 tests', () => {
	it('should re-encode a base64url to base32', async () => {
		const base64url = '9JJoD2uPiBiLm_sPdfk7XmNHQgD0vhtZxa0mtc0k2fY'
		const expectedBase32 = '6sjgqd3lr6ebrc437mhxl6j3lzruoqqa6s7bwwofvutlltje3h3a'

		const result = idToBas32(base64url)

		assert.equal(result, expectedBase32)
	})
})
