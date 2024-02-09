import knexCreate from './knexCreate'

const knex = knexCreate()

/** we can't use `-` in postgres table names, and usual starting character rules */
export const ownerToTablename = (owner: string) => `owner_${owner.replace(/-/g, '·')}`
export const tablenameToOwner = (tablename: string) => tablename.slice('owner_'.length).replace(/·/g, '-')

export const createOwnerTable = async (owner: string) => {
	const tablename = ownerToTablename(owner)
	await knex.schema.createTable(tablename, table => {
		table.specificType('txid', 'char(43)').primary()
		table.specificType('parent', 'char(43)')
		table.specificType('parents', 'char(43) ARRAY')

		table.bigInteger('byte_start') //returns string
		table.bigInteger('byte_end') //returns string

		table.dateTime('last_update').defaultTo(knex.fn.now())
	})
	return tablename;
}

/** might use this if owner gets whitelisted or for tests */
export const dropOwnerTable = async (owner: string) => {
	await knex.schema.dropTable(ownerToTablename(ownerToTablename(owner)))
}


