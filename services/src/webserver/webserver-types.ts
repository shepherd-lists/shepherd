
export interface RangelistAllowedItem {
	name: string
	server: string
}

export interface LogEvent {
	eventType: 'not-blocked' // add more later
	url: string
	item: string 
	server: RangelistAllowedItem
	status?: number
	xtrace?: string | null
	age?: string | null, 
	contentLength?: string | null
}
