import { arGql } from 'ar-gql'
import moize from 'moize'

//sanity check
const GQL_URL_SECONDARY = process.env.GQL_URL_SECONDARY
if (!GQL_URL_SECONDARY?.includes('goldsky')) throw new Error(`GQL_URL_SECONDARY: '${GQL_URL_SECONDARY}' must be a goldsky endpoint!`)


const gql = arGql(GQL_URL_SECONDARY, 1) //defaults to goldsky

export const ownerTotalCount = async (owner: string) => {
	const query = `
		query ($owner: String!){
			transactions(owners:[$owner]){count}
		}
	`
	const variables = {
		owner
	}
	const { data } = await gql.run(query, variables)

	//@ts-expect-error ar-gql doesn't have goldsky specific types
	return data.transactions.count
}

