import 'dotenv/config'
import assert from "node:assert/strict";
import { describe, it } from 'node:test'

import { txidToRange } from '../byte-ranges/txidToRange/txidToRange'


describe('byte-ranges-nested tests', () => {


	it('should return correct byte range for a trivially small ans104 2D nested dataItem', async () => {

		// tiny one with text. easier maths.
		const res = await txidToRange(
			'h1xFy--WzwsHkF0mmLnrQLn6kB8lie4kfeudt_WD9rs', //dataItem number [0][0] <= doesn't affect result what item we pick
			'GsU6C6m0593jLCSIGpQxJMNE2eCvl7MqgmU75e7JagI',
			['RkqustTWVhOmwhFp0LGoh6g9WvLP1QiUJoPDDdJ8APk']
		)
		// very small example, so result is 1 chunk holding all nested bundles. checked and on L1's boundaries
		assert.equal(res.start, 123025199767798n)
		assert.equal(res.end, 123025200029942n)



	})

	it('should return the correct byte range for a multi-chunk ans104 NESTED dataItem', async () => {
		/**
		 * both the bundles and data-items cross chunk boundaries. so we can properly test the resulting calculations
		 *
		 * Nested bundle structure
		 * // super bundle length 3
		 * L1 txid V98Mn7rbEOPtOZSbpmgytF5Z5r8Eumw47aHHlVboLe0
		 *
		 * bundle0 length 5 `GrcvhWQPP95MkHTvpEHlOpkEbfrFC5Svi8nyuteZuIE` [
		 * 	'ioaP_ChqkvSPGZpEQj4Ye0Q9DdgjqbGe7oKcifJdnCs', payloads 552kb+, will always span 3 chunks
		 * 	'LDGdyhU_XtxZNdw53f0eeZ0l3ZaHFSP-u2FRkNfRRis',
		 * 	'x2UZhLdfQ03g9BXq9A-OElc1KyppN3ayP29la1gMwBI',
		 * 	'dYYIc8DBYuDpSN0GjKH1NxjnTBs7ZNKxiq6-5O8NUwg',
		 * 	'N2rNo8i37PWB5OUHXFBf6S1A4dSc4O5dn0rNEybwqeg'
		 * ]
		 * bundle1 length 5 `KfUDG4dXAbzt4UgNSRyorgl8ZxyNf5nciV5bizJqi3g` [
		 * 	'HYZZWEwc-8Zq29e9JrfGb-4D10HOUcpFDj-rQEl9zXE',
		 * 	'kTuf34qhkr_D1UkJrP7g5QgS-D-i3nDMa5UpTeZ_iYs',
		 * 	'22QXisiUn-6RF5OJan-2_1jvC6B1W3CPozumG2sWPoo',
		 * 	'LWc2fd9icj1EP9nYGk7gY6thh3Nk4EDdgOvGS_w4nwU',
		 * 	'Nlcz6WgtBREML4m0miDtZ9UzftJt-bYLz6gj4Yni-uo'
		 * ]
		 * bundle2 length 5 `HyVW_SVJ2T8SKYGo9BTOOmKHmCHA2-8Tw2flZtL2s-A` [
		 * 	'0koS58WUTOJyWJKJh6pmtt9qHpS-YC8b-LB7-pcNUrY',
		 * 	'HqYMVJBCCubdaZknnRZYivDzQS-pkKyT-5qSJcHb_R4',
		 * 	'EFpA-zlZLTczOAPCoNUA1B2NuLpKlLU0QWTtav2LyU8',
		 * 	'VnFtyOwf9BNGg1myRbBqM8X_bXu5oV9_-hYN90ngrSA',
		 * 	'0r8UpaH63SuZ39zSfFYPuI8ITBDTAmgP9KQTODzksUk'
		 * ]
		 *
		 * Full list of chunk boundaries:
		 * 	chunks
		 * 1	123388269994230
		 * 2	123388270256374
		 * 3	123388270518518
		 * 4	123388270780662
		 * 5	123388271042806
		 * 6	123388271304950
		 * 7	123388271567094
		 * 8	123388271829238
		 * 9	123388272091382
		 * 10	123388272353526
		 * 11	123388272615670
		 * 12	123388272877814
		 * 13	123388273139958
		 * 14	123388273402102
		 * 15	123388273664246
		 * 16	123388273926390
		 * 17	123388274188534
		 * 18	123388274450678
		 * 19	123388274712822
		 * 20	123388274974966
		 * 21	123388275237110
		 * 22	123388275499254
		 * 23	123388275761398
		 * 24	123388276023542
		 * 25	123388276285686
		 * 26	123388276547830
		 * 27	123388276809974
		 * 28	123388277072118
		 * 29	123388277334262
		 * 30	123388277596406
		 * 31	123388277858550
		 * 32	123388278120694
		 * 33	123388278382838
		 * 34	123388278644982
		 *
		 */

		//right at the beginning. spanning 3
		const beginning = await txidToRange(
			'ioaP_ChqkvSPGZpEQj4Ye0Q9DdgjqbGe7oKcifJdnCs',
			'GrcvhWQPP95MkHTvpEHlOpkEbfrFC5Svi8nyuteZuIE',
			['V98Mn7rbEOPtOZSbpmgytF5Z5r8Eumw47aHHlVboLe0']
		)
		assert.equal(beginning.start, 123388269994230n)
		assert.equal(beginning.end, 123388270780662n)

		//right from the middle of the chunks. spanning 3
		const res = await txidToRange(
			'22QXisiUn-6RF5OJan-2_1jvC6B1W3CPozumG2sWPoo',
			'KfUDG4dXAbzt4UgNSRyorgl8ZxyNf5nciV5bizJqi3g',
			['V98Mn7rbEOPtOZSbpmgytF5Z5r8Eumw47aHHlVboLe0']
		)
		assert.equal(res.start, 123388273926390n)
		assert.equal(res.end, 123388274712822n)

		//right at the end. spanning 3
		const end = await txidToRange(
			'0r8UpaH63SuZ39zSfFYPuI8ITBDTAmgP9KQTODzksUk',
			'HyVW_SVJ2T8SKYGo9BTOOmKHmCHA2-8Tw2flZtL2s-A',
			['V98Mn7rbEOPtOZSbpmgytF5Z5r8Eumw47aHHlVboLe0']
		)
		assert.equal(end.start, 123388277858550n)
		assert.equal(end.end, 123388278644982n)

	})

	/** TODO: test deeply nested data-items **/

})
