import { APIFilterResult } from 'shepherd-plugin-interfaces'
import knexCreate from '../../../libs/utils/knexCreate'
import { TxRecord } from 'shepherd-plugin-interfaces/types'
import { z } from 'zod'
import isEqual from 'lodash/isEqual'
import { getByteRange as getByteRangeOriginal } from '../../../libs/byte-ranges/byteRanges'

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

export const addonHandler = async (
	{ addonPrefix, records }: { addonPrefix: string, records: TxRecord[] },
	//dependency injection for testing
	getByteRange = getByteRangeOriginal,
) => {

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
	 * just take the record
	 * check if db needs updating
	 * calc byte-ranges if needed
	 * run updateS3Lists
	 */

	/** pre-process records */
	const existingRecords = await knex<TxRecord>(`${addonPrefix}_txs`).whereIn('txid', records.map(r => r.txid))

	const updates = await Promise.all(records.map(async (record) => {

		const existingRecord = existingRecords.find(r => r.txid === record.txid)

		/** new record. most likely and basic event */
		if (!existingRecord) {
			const { txid, parent, parents } = record
			const { start, end } = await getByteRange(txid, parent, parents)
			record.byte_start = start.toString()
			record.byte_end = end.toString()
			record.last_update_date = new Date()
			return record; //updated
		}

		/** check what updates are needed, options:
		 * none
		 * byte-range (expensive)
		 * other fields
		 */

		const needsByteRangeCalc = hasValidByteRanges(existingRecord)
		const needsOtherFieldsUpdated = otherFieldsMatch(existingRecord, record)

		/** short-circuit for no changes */
		if (!needsByteRangeCalc && !needsOtherFieldsUpdated) {
			return undefined; //not updated
		}

		if (needsByteRangeCalc) {
			const { txid, parent, parents } = record
			const { start, end } = await getByteRange(txid, parent, parents)
			record.byte_start = start.toString()
			record.byte_end = end.toString()
		} else {
			//overkill?
			delete record.byte_start
			delete record.byte_end
		}

		record.last_update_date = new Date()

		/** `record` contains all the updates */
		return { ...existingRecord, ...record }

	}))

	/** remove undefined records */
	const updatedRecords = updates.filter(r => r !== undefined)

	/** update db */
	const inserts = await knex<TxRecord>(`${addonPrefix}_txs`).insert(updatedRecords).onConflict('txid').merge()
	console.info(addonHandler.name, `inserted ${inserts.length}/${records.length} records`)

	/** run updateS3Lists */
	// await updateS3Lists(filteredResults)

	return (inserts as any).rowCount
}

/** helper functions */
const hasValidByteRanges = (record: TxRecord) => {
	//testing start of byte-range is enough
	return !!record.byte_start && record.byte_start !== '-1'
}

const otherFieldsMatch = (existing: TxRecord, incoming: TxRecord) => {
	for (const key in incoming) {
		if (['last_update_date', 'byte_start', 'byte_end'].includes(key))
			continue; //skip these fields
		if (!isEqual(incoming[key as keyof TxRecord], existing[key as keyof TxRecord]))
			return false; //we found an updated value
	}
	return true;
}



