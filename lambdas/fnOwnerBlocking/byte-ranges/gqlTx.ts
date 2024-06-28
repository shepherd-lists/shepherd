/** 
 * refactoring and generalising gqlTx into it's own module for performance reasons 
 */
import { ArGqlInterface } from 'ar-gql'
import moize from 'moize'


const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** notes:
 * - connection retries are handled internally in ar-gql
 * - we will retry rate-limits and server errors
*/
export const gqlTx = moize(
	async (
		id: string, //maxArgs: 1
		gql: ArGqlInterface	//not serialized and not serializable
	) => {
		let tries = 0, maxTries = 3
		while (true) {
			try {

				console.info(gqlTx.name, `unmemoized gql.tx('${id}') using ${gql.endpointUrl}`)
				return await gql.tx(id)

			} catch (err: unknown) {
				const e = err as Error
				const status = !isNaN(Number(e.cause)) ? Number(e.cause) : null // ar-gql errors are a bit messy

				if (!status || status === 429 || status >= 500) {
					if (tries++ > maxTries) {
						throw new Error(
							`[getTx] "${e.message}" while fetching tx: "${id}" using gqlProvider: ${gql.endpointUrl}.`
							+ ` Tried ${tries} times.`
						)
					}
					console.warn(gqlTx.name, `warning: (${status}) '${e.message}', for '${id}'. retrying in 10secs...`)
					await sleep(10_000)
					continue
				}

				console.debug(e)
				throw new Error(
					`UNEXPECTED gqlTx-error: (${status}) ${e.message} for id ${id}.\n`
					+ `${e.name}:${e.message}\n`
					+ `${e.cause}\n`
					+ `${e.stack}`
				)
			}
		}
	},
	{
		isPromise: true,
		maxSize: 1_000,	//should be enough?
		maxArgs: 1, // <= important! we want to memoize by txid, and moize having issue with arGql objects
	}
)
