export interface LogEvent {
	eventType: 'not-blocked' // add more later
	url: string
	item: string 
	server: string
	status?: number
	xtrace?: string | null
	age?: string | null, 
	contentLength?: string | null
}
