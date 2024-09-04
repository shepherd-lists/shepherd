import { arGql } from 'ar-gql'

const gqlPrimary = arGql(process.env.GQL_URL!, 1) //fallback
const gqlSecondary = arGql(process.env.GQL_URL_SECONDARY!, 1) //use this as default

export const legacyRecordOwnerFix = async (txid: string) => {
	console.info('legacyRecordOwnerFix got called', txid)
	try{
		const meta = await gqlSecondary.tx(txid)
		return meta.owner.address
	}catch(error){
		console.info('legacyRecordOwnerFix fallback will be called due to previous', txid, error)
		const meta = await gqlPrimary.tx(txid)
		return meta.owner.address
	}
}