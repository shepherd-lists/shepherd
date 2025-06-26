import { APIFilterResult } from 'shepherd-plugin-interfaces'
import knexCreate from '../../../libs/utils/knexCreate'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { z } from 'zod'

const knex = knexCreate()

// Zod schema for TxRecord validation
const TxRecordSchema = z.object({
	txid: z.string(),
	content_type: z.string(),
	content_size: z.string(),
	height: z.number(),
	flagged: z.boolean().optional().nullable(),
	valid_data: z.boolean().optional().nullable(),
	parent: z.string().optional().nullable(),
	parents: z.array(z.string()).optional().nullable(),
	owner: z.string().optional().nullable(),
	data_reason: z.string().optional().nullable(),
	byte_start: z.string().optional().nullable(),
	byte_end: z.string().optional().nullable(),
	last_update_date: z.date().optional().nullable(),
	flag_type: z.enum(['test', 'matched', 'classified']).optional().nullable(),
	top_score_name: z.string().optional().nullable(),
	top_score_value: z.number().optional().nullable()
})

const RecordsArraySchema = z.array(TxRecordSchema).max(100, 'Maximum 100 records allowed per request')

const AddonHandlerArgsSchema = z.object({
	addonPrefix: z.string().min(1, 'Addon prefix is required'),
	records: RecordsArraySchema
})

export const addonHandler = async ({ addonPrefix, records }: { addonPrefix: string, records: TxRecord[] }) => {

	/** use zod to check type of records is correct */
	try {
		AddonHandlerArgsSchema.parse({ addonPrefix, records })
	} catch (error) {
		if (error instanceof z.ZodError) {
			throw new Error(`Invalid arguments: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
		}
		throw error
	}

	/** plan:
	 * just take the result
	 * add byte-ranges
	 * check if db needs updating
	 * run updateS3Lists
	 * i think that's it?
	 */

	return
	// Process each record in the array
	for (const record of records) {
		const existingRecord = await knex<TxRecord>(`${addonPrefix}_txs`).where({ txid: record.txid }).first()
		const updatedRecord = { ...(existingRecord || {}) }

		// TODO: Implement the rest of the logic based on the plan
		// - add byte-ranges
		// - check if db needs updating
		// - run updateS3Lists
	}
}
