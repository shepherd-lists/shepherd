


export interface MockConfig {
	statusCode?: number
	dataChunks?: Buffer[]
	shouldTimeout?: boolean
	timeoutDelay?: number
	shouldEnd?: boolean
}

export const createMockHttpsGet = (config: MockConfig = {}) => {
	const {
		statusCode = 200,
		dataChunks = [],
		shouldTimeout = false,
		timeoutDelay = 100,
		shouldEnd = true
	} = config

	return (url: string, options: any, callback: any) => {
		const eventHandlers: { [key: string]: any[] } = {}

		const mockResponse = {
			statusCode,
			setTimeout: (timeout: number, timeoutCallback: () => void) => {
				if (shouldTimeout) {
					setTimeout(timeoutCallback, timeoutDelay)
				}
			},
			on: (event: string, handler: any) => {
				if (!eventHandlers[event]) eventHandlers[event] = []
				eventHandlers[event].push(handler)

				// Send data chunks when data handler is registered
				if (event === 'data' && dataChunks.length > 0) {
					dataChunks.forEach((chunk, index) => {
						setTimeout(() => handler(chunk), 10 * (index + 1))
					})

					// End the stream after sending all chunks
					if (shouldEnd) {
						setTimeout(() => {
							if (eventHandlers['end']) {
								eventHandlers['end'].forEach(h => h())
							}
						}, 10 * (dataChunks.length + 1))
					}
				}
			},
			destroy: (error?: Error) => {
				if (error && eventHandlers['error']) {
					eventHandlers['error'].forEach(handler => handler(error))
				}
			}
		}

		callback(mockResponse)
		return { on: (event: string, handler: any) => { } }
	}
}
