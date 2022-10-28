/**
 * Supported types refers to nsfwjs.
 * These will all be removed once gql wildcard searches are enabled.
 */

export const supportedTypes = [
	"image/bmp",
	"image/jpeg",
	"image/png",
	"image/gif",
]

export const unsupportedTypes = [
	"image/tiff",
	"image/webp",
	"image/x-ms-bmp",
	"image/svg+xml",
	"image/apng",
	"image/heic",
]

export const imageTypes = [
	...supportedTypes,
	...unsupportedTypes,
]

export const videoTypes = [
	"video/3gpp",
	"video/3gpp2",
	"video/mp2t",
	"video/mp4",
	"video/mpeg",
	"video/ogg",
	"video/quicktime",
	"video/webm",
	"video/x-flv",
	"video/x-m4v",
	"video/x-msvideo",
	"video/x-ms-wmv",
]

// Future use
export const textTypes = [
	"text/plain",
	"application/pdf",
]

// axios/http workaround timeouts
export const NO_DATA_TIMEOUT = 40000
export const NO_STREAM_TIMEOUT = 10000

/* switch gateways */
export const HOST_URL = process.env.HOST_URL || 'https://arweave.net'
console.log(`HOST_URL`, HOST_URL)
// export const HOST_URL = 'https://arweave.dev'
// export const HOST_URL = 'https://arweave.live'

/* switch gql endpoints */
export const GQL_URL = process.env.GQL_URL || 'https://arweave-search.goldsky.com/graphql'
console.log(`GQL_URL`, GQL_URL)
// export const GQL_URL = 'https://arweave.net/graphql'

export const FEEDER_Q_VISIBILITY_TIMEOUT = 900 // 15 minutes

export type FetchersStatus = 
	'NO_DATA'
	| 'NEGLIGIBLE_DATA'
	| 'ERROR_404'
	| 'OK'
	| (string & {})

export const network_EXXX_codes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']
