import axios from "axios"

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/* use GQL height over /info height, as both can get out of sync */
export const getGqlHeight = async () => {
	while(true){
		try{
			const query = "query($minBlock: Int){ blocks( height:{min:$minBlock} first:1 ){ edges{node{height}} }}"
			const { data } =  await axios.post('https://arweave.net/graphql', {	query })
			return +data.data.blocks.edges[0].node.height
		}catch(e:any){
			console.log('error polling gql height', e.message, 'retrying in 10s..')
			await sleep(10000)
		}
	}
}