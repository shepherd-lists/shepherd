// /**
//  * Supported types refers to nsfwjs.
//  * These will all be removed once gql wildcard searches are enabled.
//  */

// export const supportedTypes = [
// 	"image/bmp",
// 	"image/jpeg",
// 	"image/png",
// 	"image/gif",
// ]

// export const unsupportedTypes = [
// 	"image/tiff",
// 	"image/webp",
// 	"image/x-ms-bmp",
// 	"image/svg+xml",
// 	"image/apng",
// 	"image/heic",
// ]

// export const imageTypes = [
// 	...supportedTypes,
// 	...unsupportedTypes,
// ]

// export const videoTypes = [
// 	"video/3gpp",
// 	"video/3gpp2",
// 	"video/mp2t",
// 	"video/mp4",
// 	"video/mpeg",
// 	"video/ogg",
// 	"video/quicktime",
// 	"video/webm",
// 	"video/x-flv",
// 	"video/x-m4v",
// 	"video/x-msvideo",
// 	"video/x-ms-wmv",
// ]

// // Future use
// export const textTypes = [
// 	"text/plain",
// 	"application/pdf",
// ]

// axios/http workaround timeouts
export const NO_DATA_TIMEOUT = 40000
export const NO_STREAM_TIMEOUT = 10000

/** set bleeding edge and clean up passes here */
export const PASS1_CONFIRMATIONS = 0
export const PASS2_CONFIRMATIONS = 15
export type IndexName = 'indexer_pass1' | 'indexer_pass2'

/* switch gateways */
/** DON'T SET DEFAULTS HERE! THAT HAPPENS IN COMPOSE FILES */
export const HOST_URL = process.env.HOST_URL as string
console.log('HOST_URL', HOST_URL)

/* switch gql endpoints */
/** DON'T SET DEFAULTS HERE! THAT HAPPENS IN COMPOSE FILES */
export const GQL_URL = process.env.GQL_URL as string
console.log('GQL_URL', GQL_URL)
export const GQL_URL_SECONDARY = process.env.GQL_URL_SECONDARY as string
console.log('GQL_URL_SECONDARY', GQL_URL_SECONDARY)
if(GQL_URL_SECONDARY && GQL_URL === GQL_URL_SECONDARY){
	console.log('Warning GQL_URL === GQL_URL_SECONDARY. This is not a good for a backup situation.')
}

/** fetchers constants */
export const FEEDER_Q_VISIBILITY_TIMEOUT = 900 // 15 minutes

export type FetchersStatus = (
	'NO_DATA'
	| 'NEGLIGIBLE_DATA'
	| 'ERROR_404'
	| 'OK'
	| 'BAD_MIME'
)


/** other constants */

export const network_EXXX_codes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']

export const ARIO_DELAY_MS = /* 600reqs / 5mins = 120/min ~= min 500ms per requeast */ 500


