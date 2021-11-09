const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const loop = async()=>{
	while(true){
		console.log('welcome to the loop')
		await sleep(600000)
	}
}
loop();