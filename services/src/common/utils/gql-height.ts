
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**  
 * use GQL height over /info height, as both can get out of sync.
 * retry on all errors.
 * */
export const gqlHeight = async (endpoint: string) => {
	while(true){
		try{
			const query = "query($minBlock: Int){ blocks( height:{min:$minBlock} first:1 ){ edges{node{height}} }}"
			const res = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ query })
			})

			if(!res.ok) throw Error(`${res.status} : ${res.statusText}`)

			return +(await res.json()).data.blocks.edges[0].node.height
		}catch(e:any){
			console.log('error polling gql height', `"${e.message}"`, 'retrying in 10s..')
			await sleep(10000)
		}
	}
}