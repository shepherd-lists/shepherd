import { arGql } from 'ar-gql'

const gqlPrimary = arGql(process.env.GQL_URL!) //fallback
const gqlSecondary = arGql(process.env.GQL_URL_SECONDARY!, 1) //use this as default

export const legacyRecordOwnerFix = async (txid: string) => {
	console.debug('legacyRecordOwnerFix got called', txid)
	try{
		const meta = await gqlSecondary.tx(txid)
		return meta.owner.address
	}catch(error){
		const meta = await gqlPrimary.tx(txid)
		return meta.owner.address
	}
}