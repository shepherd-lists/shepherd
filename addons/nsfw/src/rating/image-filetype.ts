import filetype from 'file-type'


export const getImageMime = async(buffer: Uint8Array)=> {
	const type = await filetype.fromBuffer(buffer)
	if(type === undefined) return undefined
	return type.mime;
}