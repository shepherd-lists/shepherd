import knexCreate from './knexCreate'

const knex = knexCreate()

/** we can't use `-` in postgres table names, and usual starting character rules + 63 char limit */
export const ownerToOwnerTablename = (owner: string) => `owner_${owner.replace(/-/g, '·')}` // ref fnOwnerTable

export const ownerToInfractionsTablename = (owner: string) => `infractions_${owner.replace(/-/g, '·')}`

export const tablenameToOwner = (tablename: string) => {
	if (tablename.startsWith('owner_')) return tablename.slice('owner_'.length).replace(/·/g, '-')
	if (tablename.startsWith('infractions_')) return tablename.slice('infractions_'.length).replace(/·/g, '-')
	throw new Error('invalid tablename')
}

export const createInfractionsTable = async (owner: string) => {
	const tablename = ownerToInfractionsTablename(owner)
	await knex.schema.createTable(tablename, table => {
		table.specificType('txid', 'char(43)').primary()
		table.dateTime('last_update').defaultTo(knex.fn.now())
	})
	return tablename;
}

/** might use this if owner gets whitelisted or for tests */
export const dropOwnerTables = async (owner: string) => {
	await knex.schema.dropTableIfExists(ownerToOwnerTablename(owner))
	await knex.schema.dropTableIfExists(ownerToInfractionsTablename(owner))
}

export const createOwnerTable = async (owner: string) => {
	const tablename = ownerToOwnerTablename(owner)
	await knex.schema.createTable(tablename, table => {
		table.specificType('txid', 'char(43)').primary()
		table.specificType('parent', 'char(43)')
		table.specificType('parents', 'char(43) ARRAY')
		table.bigInteger('byte_start')
		table.bigInteger('byte_end')
		table.dateTime('last_update').defaultTo(knex.fn.now())
	})

	return tablename
}