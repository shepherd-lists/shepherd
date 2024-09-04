import knexCreate from '../src/common/utils/db-connection'
import { arGql, GQLUrls } from 'ar-gql'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const knex = knexCreate()
const gql = arGql(GQLUrls.goldsky)

const query = `
query($ids: [ID!]) {
  transactions(
    ids:$ids
    first: 100
  ){
    edges{node{
      id
      owner{address}
    }}
  }
}
`



const main = async()=>{
	/** get inbox txids */
	const txids = await knex('txs').select('txid')
		.where('top_score_value', '>=', 0.9)
		// .where('flagged', true)
		.whereNull('owner')
	console.info(`${txids.length} txids`)

	while(txids.length > 0){
		const ids = txids.splice(0, 100).map((txid)=>txid.txid)

		while(true){
			try{
				const { data } = await gql.run(query, { ids } )
				const edges = data.transactions.edges
				console.debug('gql edges', edges.length) //need to switch provider?

				await Promise.all(	edges.map(async (edge) => {
					const owner = edge.node.owner.address
					const txid = edge.node.id
					console.log(
						'updating',JSON.stringify({txid, owner}),
						'result', await knex('txs').where({ txid }).update({ owner }).onConflict().ignore()
					)
				}))
				break
			}catch(e){
				console.error('some error happened, dont care', e)
				await sleep(5_000)
			}
		}
	}


	knex.destroy()

}
main()

