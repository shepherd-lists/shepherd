import axios from "axios"
import { GQL_URL } from '../constants'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/* use GQL height over /info height, as both can get out of sync */
export const getGqlHeight = async () => {
	while(true){
		try{
			const query = "query($minBlock: Int){ blocks( height:{min:$minBlock} first:1 ){ edges{node{height}} }}"
			const { data } =  await axios.post(GQL_URL, {	query })
			return +data.data.blocks.edges[0].node.height
		}catch(e:any){
			console.log('error polling gql height', e.message, 'retrying in 10s..')
			await sleep(10000)
		}
	}
}