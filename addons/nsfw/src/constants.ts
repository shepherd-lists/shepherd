// axios/http workaround timeouts
export const NO_DATA_TIMEOUT = 40000
export const NO_STREAM_TIMEOUT = 10000

// temp dir for video processing
export const VID_TMPDIR = './temp-screencaps/'
export const VID_TMPDIR_MAXSIZE = 8 * 1024 ** 3 // 2 GB <=TODO: should also check actual free disk space

//docker-compose: HOST_URL: ${HOST_URL:-https://arweave.net}

export const supportedTypes = [
	"image/bmp",
	"image/jpeg",
	"image/png",
	"image/gif",
]
/** @deprecated */
export const unsupportedTypes = [
	"image/tiff",
	"image/webp",
	"image/x-ms-bmp",
	"image/svg+xml",
	"image/apng",
	"image/heic",
]
/** @deprecated */
export const imageTypes = [
	...supportedTypes,
	...unsupportedTypes,
]
/** @deprecated */
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
