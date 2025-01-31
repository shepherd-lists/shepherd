import { arGql } from 'ar-gql'
import moize from 'moize'

//sanity check
const GQL_URL_SECONDARY = process.env.GQL_URL_SECONDARY
if (!GQL_URL_SECONDARY?.includes('goldsky')) throw new Error(`GQL_URL_SECONDARY: '${GQL_URL_SECONDARY}' must be a goldsky endpoint!`)


const gql = arGql({ endpointUrl: GQL_URL_SECONDARY, retries: 1 }) //defaults to goldsky

export const ownerTotalCount = moize(
	async (owner: string) => {
		const query = `
			query ($owner: String!){ 
				transactions( 
					owners:[ $owner ]
					#remove pending results
					sort: HEIGHT_DESC
				){ 
					count 
				} 
			}
		`
		const variables = {
			owner
		}
		const { data } = await gql.run(query, variables)

		//@ts-expect-error ar-gql doesn't have goldsky specific types
		const count = data.transactions.count
		console.info(`ownerTotalCount( ${owner} ) = ${count}`)

		return count as number;
	},
	{
		maxSize: 1_000, //is this enough?
		isPromise: true,
		maxAge: 86_400_000 //1000 * 60 * 60 * 24 = 1 day
	}
)

