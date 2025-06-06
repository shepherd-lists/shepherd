import Arweave from 'arweave'
import base32Encode from 'base32-encode'


export const idToBas32 = (id: string) => {
	const buffer = Arweave.utils.b64UrlToBuffer(id)
	return base32Encode(buffer, 'RFC4648', { padding: false }).toLocaleLowerCase()
}
