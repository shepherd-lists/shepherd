export interface OwnerTableRecord {
	txid: string
	parent: string | null
	parents: string[] | undefined
	byte_start?: string
	byte_end?: string
	last_update?: Date //default to now on creation
}

export interface OwnersWhitelistRecord {
	owner: string
	last_update: Date
}

export interface OwnersListRecord {
	owner: string
	last_update: Date
	infractions: number
	add_method: string
}

