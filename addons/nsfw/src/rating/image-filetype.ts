import filetype from 'file-type'


export const getImageMime = async (buffer: Uint8Array) => {
	const type = await filetype.fromBuffer(buffer)
	if (type === undefined) return undefined
	if (type.mime === 'application/xml') return 'image/svg+xml' //feature with the `file-type` library
	return type.mime
}